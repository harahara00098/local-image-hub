import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import multer from "multer";

async function startServer() {
  const app = express();
  const PORT = 80;
  const IMAGES_DIR = path.join(process.cwd(), "images");
  // 開発環境のファイル監視から外すため、imagesフォルダ内に隠しファイルとして保存
  const METADATA_FILE = path.join(IMAGES_DIR, ".metadata.json");

  // メタデータのメモリキャッシュ
  let metadataCache: any = null;

  // メタデータ（タグ情報）の読み込み
  const getMetadata = () => {
    if (metadataCache) return metadataCache;
    if (!fs.existsSync(METADATA_FILE)) return {};
    try {
      metadataCache = JSON.parse(fs.readFileSync(METADATA_FILE, "utf-8"));
      return metadataCache;
    } catch {
      return {};
    }
  };

  const getParentTags = (itemPath: string, metadata: any) => {
    const parts = itemPath.split('/').filter(Boolean);
    const tags = new Set<string>();
    let current = '';
    if (metadata['/']) metadata['/'].forEach((t: string) => tags.add(t));
    
    for (let i = 0; i < parts.length - 1; i++) {
      current += '/' + parts[i];
      if (metadata[current]) {
        metadata[current].forEach((t: string) => tags.add(t));
      }
    }
    return Array.from(tags);
  };

  // メタデータの保存
  const saveMetadata = (data: any) => {
    metadataCache = data;
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
  };

  // ルーティングの前に JSON パーサーを配置
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Ensure images directory exists
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    // Create some placeholder structure
    fs.mkdirSync(path.join(IMAGES_DIR, "travel"), { recursive: true });
    fs.mkdirSync(path.join(IMAGES_DIR, "work"), { recursive: true });
  }

  // Configure storage for uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      // フロントエンドから送られた path を取得
      const subPath = req.body.path || "/";
      const decodedSubPath = decodeURIComponent(subPath);
      const fullPath = path.join(IMAGES_DIR, decodedSubPath);

      // セキュリティチェック: IMAGES_DIR の外に出ないようにする
      const absoluteImagesDir = path.resolve(IMAGES_DIR);
      const absoluteFullPath = path.resolve(fullPath);
      if (!absoluteFullPath.startsWith(absoluteImagesDir)) {
        return cb(new Error("アクセスが拒否されました"), "");
      }

      cb(null, fullPath);
    },
    filename: (req, file, cb) => {
      // 元のファイル名を使用
      cb(null, file.originalname);
    }
  });

  const upload = multer({ storage });

  // API to list folders and images
  app.get("/api/browse*", (req, res) => {
    // req.params[0] will be something like "/a/b"
    const subPath = req.params[0] || "/";
    const decodedSubPath = decodeURIComponent(subPath);
    const fullPath = path.join(IMAGES_DIR, decodedSubPath);

    // Security check: ensure fullPath is within IMAGES_DIR
    const absoluteImagesDir = path.resolve(IMAGES_DIR);
    const absoluteFullPath = path.resolve(fullPath);

    if (!absoluteFullPath.startsWith(absoluteImagesDir)) {
      return res.status(403).json({ error: "アクセスが拒否されました" });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "見つかりません" });
    }

    const metadata = getMetadata();

    try {
      const stats = fs.statSync(fullPath);
      const metadata = getMetadata();

      // 現在のパスの接頭辞を作成（再帰的な集計用）
      const currentPathPrefix = decodedSubPath === '/' ? '' : (decodedSubPath.endsWith('/') ? decodedSubPath : decodedSubPath + '/');

      // --- 最適化: このディレクトリ配下の全タグを一括集計 ---
      const tagCounts: Record<string, number> = {};
      const pathTagsMap: Record<string, string[]> = {}; // 高速参照用
      const folderTagsMap: Record<string, Set<string>> = {}; // フォルダごとの集計キャッシュ

      Object.entries(metadata).forEach(([key, tags]) => {
        if (key.startsWith(currentPathPrefix)) {
          const tagList = Array.isArray(tags) ? tags : [];
          pathTagsMap[key] = tagList;
          
          if (tagList.length > 0) {
            tagList.forEach((t: string) => {
              tagCounts[t] = (tagCounts[t] || 0) + 1;
            });

            // 親フォルダへのタグ波及を計算 (O(N) で済むように事前集計)
            let parts = key.split('/');
            let currentAggPath = '';
            for (let i = 1; i < parts.length - 1; i++) {
              currentAggPath += '/' + parts[i];
              if (!folderTagsMap[currentAggPath]) folderTagsMap[currentAggPath] = new Set();
              tagList.forEach(t => folderTagsMap[currentAggPath].add(t));
            }
          }
        }
      });

      const popularTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => ({ tag, count }));
      // ----------------------------------------------

      const parentDir = path.dirname(fullPath);
      const isCurrentDirectory = stats.isDirectory();
      
      const parentItems = fs.readdirSync(parentDir, { withFileTypes: true })
        .filter(item => !item.name.startsWith('.'))
        .filter(item => {
          if (isCurrentDirectory) return item.isDirectory();
          return !item.isDirectory();
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      
      const currentIndex = parentItems.findIndex(item => item.name === path.basename(fullPath));
      let prevPath = null;
      let nextPath = null;
      
      if (currentIndex !== -1 && decodedSubPath !== "/") {
        if (currentIndex > 0) {
          const prevItem = parentItems[currentIndex - 1];
          const p = path.join(path.dirname(decodedSubPath), prevItem.name).replace(/\\/g, '/');
          prevPath = p.startsWith('/') ? p : '/' + p;
        }
        if (currentIndex < parentItems.length - 1) {
          const nextItem = parentItems[currentIndex + 1];
          const p = path.join(path.dirname(decodedSubPath), nextItem.name).replace(/\\/g, '/');
          nextPath = p.startsWith('/') ? p : '/' + p;
        }
      }

      if (stats.isDirectory()) {
        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        const result = items
          .filter(item => !item.name.startsWith('.'))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          .map((item) => {
            const relativePath = path.join(decodedSubPath, item.name).replace(/\\/g, '/');
            const itemPath = relativePath.startsWith('/') ? relativePath : '/' + relativePath;

            // Define itemBase here, common properties for both files and directories
            const itemBase = {
              name: item.name,
              isDirectory: item.isDirectory(),
              path: itemPath,
              isImage: /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(item.name),
            };

            let folderPreviews = [];
            let hasSubDirectories = false;

            if (item.isDirectory()) {
              try {
                const subItems = fs.readdirSync(path.join(fullPath, item.name), { withFileTypes: true });
                // フォルダ内の画像を探す (最大4枚)
                const images = subItems
                  .filter(si => !si.isDirectory() && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(si.name))
                  .slice(0, 4);
                
                folderPreviews = images.map(img => {
                  const p = path.join(itemPath, img.name).replace(/\\/g, '/');
                  return p.startsWith('/') ? p : '/' + p;
                });

                // サブフォルダがあるかチェック
                hasSubDirectories = subItems.some(si => si.isDirectory() && !si.name.startsWith('.'));
              } catch (e) {
                // アクセス権限エラーなどは無視
              }
            }

            // フォルダの場合は、自身のタグと配下のパスに一致するタグを事前に集計したマップから取得してマージ
            if (item.isDirectory()) {
              const ownTags = pathTagsMap[itemPath] || [];
              const inheritedTags = Array.from(folderTagsMap[itemPath] || []);
              const mergedTags = Array.from(new Set([...ownTags, ...inheritedTags]));
              
              return {
                ...itemBase,
                tags: mergedTags,
                parentTags: getParentTags(itemPath, metadata),
                folderPreviews,
                hasSubDirectories
              };
            } else {
              return {
                ...itemBase,
                tags: pathTagsMap[itemPath] || [],
                parentTags: getParentTags(itemPath, metadata),
                folderPreviews: [], // Files don't have folderPreviews
                hasSubDirectories: false // Files don't have subdirectories
              };
            }
          });
        res.json({ 
          type: "directory", 
          items: result, 
          popularTags, 
          prevPath, 
          nextPath,
          currentTags: metadata[decodedSubPath] || []
        });
      } else {
        res.json({ 
          type: "file", 
          name: path.basename(fullPath), 
          path: decodedSubPath,
          isImage: /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fullPath),
          tags: metadata[decodedSubPath] || [],
          parentTags: getParentTags(decodedSubPath, metadata),
          prevPath,
          nextPath
        });
      }
    } catch (err) {
      res.status(500).json({ error: "サーバーエラーが発生しました" });
    }
  });

  // API to handle file uploads
  app.post("/api/upload", upload.single("file"), (req, res) => {
    res.json({ message: "ファイルが正常にアップロードされました" });
  });

  // API to get all directories (recursive)
  app.get("/api/all-folders", (req, res) => {
    const getDirs = (dir: string, list: string[] = []) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const relPath = path.relative(IMAGES_DIR, dir).replace(/\\/g, '/') || "/";
      const formattedPath = relPath.startsWith('/') ? relPath : '/' + relPath;
      list.push(formattedPath);
      items.forEach(item => {
        if (item.isDirectory() && !item.name.startsWith('.')) {
          getDirs(path.join(dir, item.name), list);
        }
      });
      return list;
    };
    try {
      res.json(getDirs(IMAGES_DIR));
    } catch (err) {
      res.status(500).json({ error: "フォルダ一覧の取得に失敗しました" });
    }
  });

  // API to get all unique tags
  app.get("/api/all-tags", (req, res) => {
    const metadata = getMetadata();
    const allTags = new Set<string>();
    Object.keys(metadata).forEach((key) => {
      if (key.startsWith('/')) {
        const tags = metadata[key];
        if (Array.isArray(tags)) {
          tags.forEach(tag => allTags.add(tag));
        }
      }
    });
    res.json(Array.from(allTags).sort());
  });

  // API to serve README.md
  app.get("/README.md", (req, res) => {
    res.sendFile(path.join(process.cwd(), "README.md"));
  });

  // API to rename a file
  app.post("/api/rename", (req, res) => {
    const { path: subPath, newName } = req.body;
    if (!subPath || !newName) return res.status(400).json({ error: "パスと新しい名前が必要です" });

    const decodedSubPath = decodeURIComponent(subPath);
    const oldFullPath = path.join(IMAGES_DIR, decodedSubPath);
    const newFullPath = path.join(path.dirname(oldFullPath), newName);

    if (!fs.existsSync(oldFullPath)) return res.status(404).json({ error: "ファイルが見つかりません" });

    try {
      fs.renameSync(oldFullPath, newFullPath);
      
      // メタデータも更新
      const metadata = getMetadata();
      const newSubPath = path.join(path.dirname(decodedSubPath), newName).replace(/\\/g, '/');
      const fixedNewSubPath = newSubPath.startsWith('/') ? newSubPath : '/' + newSubPath;

      const oldPrefix = decodedSubPath.endsWith('/') ? decodedSubPath : decodedSubPath + '/';
      const newPrefix = fixedNewSubPath.endsWith('/') ? fixedNewSubPath : fixedNewSubPath + '/';

      const updatedMetadata: any = {};
      Object.keys(metadata).forEach(key => {
        if (key === decodedSubPath) {
          updatedMetadata[fixedNewSubPath] = metadata[key];
        } else if (key.startsWith(oldPrefix)) {
          // 配下のファイルのパスを置換
          const newKey = fixedNewSubPath + key.substring(decodedSubPath.length);
          updatedMetadata[newKey] = metadata[key];
        } else {
          updatedMetadata[key] = metadata[key];
        }
      });
      saveMetadata(updatedMetadata);

      res.json({ message: "名前を変更しました" });
    } catch (err) {
      res.status(500).json({ error: "名前の変更に失敗しました" });
    }
  });

  // API to move multiple files to another directory
  app.post("/api/bulk-move", (req, res) => {
    const { paths: subPaths, destDir } = req.body;
    if (!subPaths || !Array.isArray(subPaths) || destDir === undefined) {
      return res.status(400).json({ error: "パス（配列）と移動先ディレクトリが必要です" });
    }

    const decodedDestDir = decodeURIComponent(destDir);
    const absoluteImagesDir = path.resolve(IMAGES_DIR);
    const destFullPath = path.join(IMAGES_DIR, decodedDestDir);

    if (!path.resolve(destFullPath).startsWith(absoluteImagesDir) || !fs.existsSync(destFullPath)) {
      return res.status(404).json({ error: "移動先ディレクトリが見つかりません" });
    }

    const results = [];
    const metadata = getMetadata();
    let metadataChanged = false;

    for (const subPath of subPaths) {
      const decodedSubPath = decodeURIComponent(subPath);
      const oldFullPath = path.join(IMAGES_DIR, decodedSubPath);
      const filename = path.basename(oldFullPath);
      const newFullPath = path.join(destFullPath, filename);

      if (!path.resolve(oldFullPath).startsWith(absoluteImagesDir) || !fs.existsSync(oldFullPath)) {
        results.push({ path: subPath, success: false, error: "ファイルが見つかりません" });
        continue;
      }

      try {
        fs.renameSync(oldFullPath, newFullPath);
        
        const newSubPath = path.join(decodedDestDir, filename).replace(/\\/g, '/');
        const fixedNewSubPath = newSubPath.startsWith('/') ? newSubPath : '/' + newSubPath;

        if (metadata[decodedSubPath]) {
          metadata[fixedNewSubPath] = metadata[decodedSubPath];
          delete metadata[decodedSubPath];
          metadataChanged = true;
        }
        results.push({ path: subPath, success: true });
      } catch (err) {
        results.push({ path: subPath, success: false, error: "移動に失敗しました" });
      }
    }

    if (metadataChanged) saveMetadata(metadata);
    res.json({ results });
  });

  // API to delete multiple files
  app.post("/api/bulk-delete", (req, res) => {
    const { paths: subPaths } = req.body;
    if (!subPaths || !Array.isArray(subPaths)) return res.status(400).json({ error: "パス（配列）が必要です" });

    const absoluteImagesDir = path.resolve(IMAGES_DIR);
    const metadata = getMetadata();
    let metadataChanged = false;
    const results = [];

    for (const subPath of subPaths) {
      const decodedSubPath = decodeURIComponent(subPath);
      const fullPath = path.join(IMAGES_DIR, decodedSubPath);

      const absoluteFullPath = path.resolve(fullPath);
      const relative = path.relative(absoluteImagesDir, absoluteFullPath);
      const isInside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

      if (!isInside || !fs.existsSync(fullPath)) {
        results.push({ path: subPath, success: false, error: "アクセス拒否または見つかりません" });
        continue;
      }

      try {
        if (fs.statSync(fullPath).isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          const prefix = decodedSubPath.endsWith('/') ? decodedSubPath : decodedSubPath + '/';
          Object.keys(metadata).forEach(key => {
            if (key === decodedSubPath || key.startsWith(prefix)) {
              delete metadata[key];
              metadataChanged = true;
            }
          });
        } else {
          fs.unlinkSync(fullPath);
          if (metadata[decodedSubPath]) {
            delete metadata[decodedSubPath];
            metadataChanged = true;
          }
        }
        results.push({ path: subPath, success: true });
      } catch (err) {
        results.push({ path: subPath, success: false, error: "削除に失敗しました" });
      }
    }

    if (metadataChanged) saveMetadata(metadata);
    res.json({ results });
  });

  // API to add a tag to multiple files
  app.post("/api/bulk-add-tag", (req, res) => {
    const { paths: subPaths, tag } = req.body;
    if (!subPaths || !Array.isArray(subPaths) || !tag) return res.status(400).json({ error: "パス（配列）とタグが必要です" });

    const metadata = getMetadata();
    const cleanTag = tag.trim();
    if (!cleanTag) return res.status(400).json({ error: "有効なタグを入力してください" });

    subPaths.forEach(subPath => {
      const decodedSubPath = decodeURIComponent(subPath);
      if (!metadata[decodedSubPath]) metadata[decodedSubPath] = [];
      if (!metadata[decodedSubPath].includes(cleanTag)) {
        metadata[decodedSubPath].push(cleanTag);
      }
    });

    saveMetadata(metadata);
    res.json({ message: "タグを一括追加しました" });
  });

  // API to move a file to another directory
  app.post("/api/move", (req, res) => {
    const { path: subPath, destDir } = req.body;
    if (!subPath || destDir === undefined) return res.status(400).json({ error: "パスと移動先ディレクトリが必要です" });

    const decodedSubPath = decodeURIComponent(subPath);
    const decodedDestDir = decodeURIComponent(destDir);
    
    const oldFullPath = path.join(IMAGES_DIR, decodedSubPath);
    const filename = path.basename(oldFullPath);
    const newFullPath = path.join(IMAGES_DIR, decodedDestDir, filename);

    const absoluteImagesDir = path.resolve(IMAGES_DIR);
    if (!path.resolve(oldFullPath).startsWith(absoluteImagesDir) || 
        !path.resolve(newFullPath).startsWith(absoluteImagesDir)) {
      return res.status(403).json({ error: "アクセスが拒否されました" });
    }

    if (!fs.existsSync(oldFullPath)) return res.status(404).json({ error: "ファイルが見つかりません" });
    if (!fs.existsSync(path.join(IMAGES_DIR, decodedDestDir))) return res.status(404).json({ error: "移動先ディレクトリが見つかりません" });

    try {
      fs.renameSync(oldFullPath, newFullPath);
      const metadata = getMetadata();
      const newSubPath = path.join(decodedDestDir, filename).replace(/\\/g, '/');
      const fixedNewSubPath = newSubPath.startsWith('/') ? newSubPath : '/' + newSubPath;
      if (metadata[decodedSubPath]) {
        metadata[fixedNewSubPath] = metadata[decodedSubPath];
        delete metadata[decodedSubPath];
        saveMetadata(metadata);
      }
      res.json({ message: "ファイルを移動しました", newPath: fixedNewSubPath });
    } catch (err) {
      res.status(500).json({ error: "ファイルの移動に失敗しました" });
    }
  });

  // API to update tags
  app.post("/api/tags", (req, res) => {
    const { path: subPath, tags } = req.body;
    if (!subPath || !tags) return res.status(400).json({ error: "パスとタグが必要です" });

    const decodedSubPath = decodeURIComponent(subPath);
    const metadata = getMetadata();
    metadata[decodedSubPath] = tags;
    saveMetadata(metadata);

    res.json({ message: "タグを更新しました" });
  });

  // API to delete a file
  app.delete("/api/delete", (req, res) => {
    const { path: subPath } = req.body;
    if (!subPath) return res.status(400).json({ error: "パスが必要です" });

    const decodedSubPath = decodeURIComponent(subPath);
    const fullPath = path.join(IMAGES_DIR, decodedSubPath);

    const absoluteImagesDir = path.resolve(IMAGES_DIR);
    const absoluteFullPath = path.resolve(fullPath);

    // Windows のドライブレターやパスの違いを考慮したより安全なチェック
    const relative = path.relative(absoluteImagesDir, absoluteFullPath);
    const isInside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isInside) {
      return res.status(403).json({ 
        error: "アクセスが拒否されました",
        details: "imagesディレクトリ外のファイルは削除できません"
      });
    }

    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      return res.status(404).json({ error: "ファイルが見つかりません" });
    }

    try {
      fs.unlinkSync(fullPath);

      // メタデータ（タグ情報）からも削除
      const metadata = getMetadata();
      if (metadata[decodedSubPath]) {
        delete metadata[decodedSubPath];
        saveMetadata(metadata);
      }

      res.json({ message: "ファイルを削除しました" });
    } catch (err) {
      console.error("Delete error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "ファイルの削除に失敗しました" });
    }
  });

  // API to delete a directory
  app.delete("/api/delete-dir", (req, res) => {
    const { path: subPath } = req.body;
    if (!subPath) return res.status(400).json({ error: "パスが必要です" });

    const decodedSubPath = decodeURIComponent(subPath);
    const fullPath = path.join(IMAGES_DIR, decodedSubPath);

    const absoluteImagesDir = path.resolve(IMAGES_DIR);
    const absoluteFullPath = path.resolve(fullPath);

    const relative = path.relative(absoluteImagesDir, absoluteFullPath);
    const isInside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isInside) {
      return res.status(403).json({ error: "アクセスが拒否されました" });
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
      return res.status(404).json({ error: "ディレクトリが見つかりません" });
    }

    try {
      fs.rmSync(fullPath, { recursive: true, force: true });

      // メタデータからも配下のアイテム含め削除
      const metadata = getMetadata();
      const prefix = decodedSubPath.endsWith('/') ? decodedSubPath : decodedSubPath + '/';
      Object.keys(metadata).forEach(key => {
        if (key === decodedSubPath || key.startsWith(prefix)) {
          delete metadata[key];
        }
      });
      saveMetadata(metadata);

      res.json({ message: "ディレクトリを削除しました" });
    } catch (err) {
      console.error("Delete dir error:", err);
      res.status(500).json({ error: "ディレクトリの削除に失敗しました" });
    }
  });

  // API to create a directory
  app.post("/api/mkdir", (req, res) => {
    const { path: subPath, name } = req.body;
    if (!subPath || !name) return res.status(400).json({ error: "パスと名前が必要です" });

    const decodedSubPath = decodeURIComponent(subPath);
    const fullPath = path.join(IMAGES_DIR, decodedSubPath, name);

    const absoluteImagesDir = path.resolve(IMAGES_DIR);
    const absoluteFullPath = path.resolve(fullPath);

    if (!absoluteFullPath.startsWith(absoluteImagesDir)) {
      return res.status(403).json({ error: "アクセスが拒否されました" });
    }

    try {
      if (fs.existsSync(fullPath)) {
        return res.status(400).json({ error: "ディレクトリが既に存在します" });
      }
      fs.mkdirSync(fullPath, { recursive: true });
      res.json({ message: "ディレクトリを作成しました" });
    } catch (err) {
      console.error("Mkdir error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "ディレクトリの作成に失敗しました" });
    }
  });

  // Serve static images directly
  app.use("/raw-images", express.static(IMAGES_DIR));

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
