import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import multer from "multer";

// 指定フォルダ配下のすべてのファイルを再帰的に取得
const getAllFiles = (dirPath: string, baseDir: string): string[] => {
  let results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;

  const list = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const item of list) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, baseDir));
    } else {
      // IMAGES_DIR からの相対パスを作成し、先頭にスラッシュを付与してフォーマットを統一 (/test/a.jpg 等)
      let normPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      if (!normPath.startsWith('/')) normPath = '/' + normPath;
      results.push(normPath);
    }
  }
  return results;
};

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

  // 親フォルダの継承タグを取得
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

  // images ディレクトリと初期構造が存在することを確認
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    fs.mkdirSync(path.join(IMAGES_DIR, "travel"), { recursive: true });
    fs.mkdirSync(path.join(IMAGES_DIR, "work"), { recursive: true });
  }

  // アップロードファイルの保存先とファイル名の設定
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const subPath = req.body.path || "/";
      const decodedSubPath = decodeURIComponent(subPath);
      const fullPath = path.join(IMAGES_DIR, decodedSubPath);

      // セキュリティチェック: IMAGES_DIR の外に出ないように制限
      const absoluteImagesDir = path.resolve(IMAGES_DIR);
      const absoluteFullPath = path.resolve(fullPath);
      if (!absoluteFullPath.startsWith(absoluteImagesDir)) {
        return cb(new Error("アクセスが拒否されました"), "");
      }

      cb(null, fullPath);
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname);
    }
  });

  const upload = multer({ storage });

  // タグから指定フォルダ配下のファイルを検索するAPI
  app.get("/api/search-by-tag", (req, res) => {
    const targetTag = req.query.tag as string;
    const currentDir = (req.query.dir as string) || "/";

    if (!targetTag) {
      return res.status(400).json({ error: "タグの指定が必要です" });
    }

    const targetTagsLower = targetTag.split(',').map(t => t.trim().toLowerCase());
    const decodedDir = decodeURIComponent(currentDir);
    const metadata = getMetadata();

    // 再帰的に親フォルダの継承タグを取得する内部ヘルパー関数
    const getParentTagsLocal = (itemPath: string) => {
      const parts = itemPath.split('/').filter(Boolean);
      const pTags = new Set<string>();
      if (metadata['/']) metadata['/'].forEach((t: string) => pTags.add(t));
      let curr = '';
      for (let i = 0; i < parts.length - 1; i++) {
        curr += '/' + parts[i];
        const folderTags = metadata[curr] || metadata[curr.replace(/^\//, '')] || [];
        folderTags.forEach((t: string) => pTags.add(t));
      }
      return Array.from(pTags);
    };

    const finalItems = [];

    // 現在のディレクトリ配下の実ファイルを再帰的に取得
    const currentDirPhysical = path.join(IMAGES_DIR, decodedDir.replace(/^\//, ''));
    const allFiles = getAllFiles(currentDirPhysical, IMAGES_DIR);

    // 実ファイルのタグ情報を走査し、ターゲットタグを満たすか判定（AND検索）
    for (const itemPath of allFiles) {
      const filename = path.basename(itemPath);
      const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename);
      if (!isImage) continue;

      const ownTags = metadata[itemPath] || metadata[itemPath.replace(/^\//, '')] || [];
      const parentTags = getParentTagsLocal(itemPath);

      const itemAllTagsLower = [...ownTags, ...parentTags].map(t => t.toLowerCase());
      const hasAllTargetTags = targetTagsLower.every(t => itemAllTagsLower.includes(t));

      if (hasAllTargetTags) {
        finalItems.push({
          name: filename,
          isDirectory: false,
          path: itemPath,
          isImage: isImage,
          tags: ownTags,
          parentTags: parentTags,
          folderPreviews: [],
          hasSubDirectories: false
        });
      }
    }

    // 抽出されたアイテムから、関連するタグのみを再集計する
    const allTagCounts: Record<string, number> = {};
    finalItems.forEach(item => {
      const itemAllTags = new Set([...(item.tags || []), ...(item.parentTags || [])]);
      itemAllTags.forEach(t => {
        if (t) allTagCounts[t] = (allTagCounts[t] || 0) + 1;
      });
    });

    const popularTags = Object.entries(allTagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));

    res.json({
      type: "directory",
      items: finalItems,
      popularTags: popularTags,
      prevPath: null,
      nextPath: null,
      currentTags: metadata[decodedDir] || metadata[decodedDir.replace(/^\//, '')] || []
    });
  });

  // フォルダおよびファイルの一覧を取得するAPI
  app.get("/api/browse*", (req, res) => {
    const subPath = req.params[0] || "/";
    const decodedSubPath = decodeURIComponent(subPath);
    const fullPath = path.join(IMAGES_DIR, decodedSubPath);

    const absoluteImagesDir = path.resolve(IMAGES_DIR);
    const absoluteFullPath = path.resolve(fullPath);

    if (!absoluteFullPath.startsWith(absoluteImagesDir)) {
      return res.status(403).json({ error: "アクセスが拒否されました" });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "見つかりません" });
    }

    try {
      const stats = fs.statSync(fullPath);
      const metadata = getMetadata();

      const currentPathPrefix = decodedSubPath === '/' ? '' : (decodedSubPath.endsWith('/') ? decodedSubPath : decodedSubPath + '/');

      // ディレクトリ配下の全タグの一括集計およびキャッシュ作成
      const tagCounts: Record<string, number> = {};
      const pathTagsMap: Record<string, string[]> = {};
      const folderTagsMap: Record<string, Set<string>> = {};

      Object.entries(metadata).forEach(([key, tags]) => {
        if (key.startsWith(currentPathPrefix)) {
          const tagList = Array.isArray(tags) ? tags : [];
          pathTagsMap[key] = tagList;

          if (tagList.length > 0) {
            tagList.forEach((t: string) => {
              tagCounts[t] = (tagCounts[t] || 0) + 1;
            });

            // 親フォルダへのタグ波及を事前集計
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

            const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(item.name);

            const itemBase = {
              name: item.name,
              isDirectory: item.isDirectory(),
              path: itemPath,
              isImage: /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(item.name),
            };

            // フォルダプレビューを再帰的に取得するヘルパー関数
            const getPreviewsRecursive = (currentDir: string, currentRelativePath: string, limit: number): string[] => {
              let foundPreviews: string[] = [];
              try {
                const entries = fs.readdirSync(currentDir, { withFileTypes: true });
                // 1. 直下の画像を探す
                for (const entry of entries) {
                  if (!entry.isDirectory()) {
                    const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(entry.name);
                    const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(entry.name);
                    if (!isImage && !isVideo) continue;

                    const p = path.join(currentRelativePath, entry.name).replace(/\\/g, '/');
                    const previewPath = p.startsWith('/') ? p : '/' + p;
                    if (isVideo) {
                      // 動画の場合は、フロントエンドが判別できるよう 'video:' プレフィックスを付与する
                      foundPreviews.push(`video:${previewPath}`);
                    } else {
                      foundPreviews.push(previewPath);
                    }
                    if (foundPreviews.length >= limit) return foundPreviews;
                  }
                }
                // 2. サブフォルダを再帰的に探す
                for (const entry of entries) {
                  if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const remaining = limit - foundPreviews.length;
                    if (remaining > 0) {
                      const nestedPreviews = getPreviewsRecursive(path.join(currentDir, entry.name), path.join(currentRelativePath, entry.name), remaining);
                      foundPreviews = foundPreviews.concat(nestedPreviews);
                      if (foundPreviews.length >= limit) return foundPreviews.slice(0, limit);
                    }
                  }
                }
              } catch (e) { /* アクセス権限エラー等は無視 */ }
              return foundPreviews;
            };

            let folderPreviews: string[] = [];
            let hasSubDirectories = false;

            if (item.isDirectory()) {
              folderPreviews = getPreviewsRecursive(path.join(fullPath, item.name), itemPath, 4);
              hasSubDirectories = fs.readdirSync(path.join(fullPath, item.name), { withFileTypes: true }).some(si => si.isDirectory() && !si.name.startsWith('.'));
            }

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
                folderPreviews: [],
                hasSubDirectories: false
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

  // ファイルアップロード受取API
  app.post("/api/upload", upload.single("file"), (req, res) => {
    res.json({ message: "ファイルが正常にアップロードされました" });
  });

  // 全フォルダ構造を再帰的に取得するAPI
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

  // システムに存在するすべての固有タグを取得するAPI
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

  // README.md 配信API
  app.get("/README.md", (req, res) => {
    res.sendFile(path.join(process.cwd(), "README.md"));
  });

  // ファイル/フォルダの名前変更API
  app.post("/api/rename", (req, res) => {
    const { path: subPath, newName } = req.body;
    if (!subPath || !newName) return res.status(400).json({ error: "パスと新しい名前が必要です" });

    const decodedSubPath = decodeURIComponent(subPath);
    const oldFullPath = path.join(IMAGES_DIR, decodedSubPath);
    const newFullPath = path.join(path.dirname(oldFullPath), newName);

    if (!fs.existsSync(oldFullPath)) return res.status(404).json({ error: "ファイルが見つかりません" });

    try {
      fs.renameSync(oldFullPath, newFullPath);

      // 変更に合わせてメタデータ内の該当パスキーを一括更新
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

  // 複数ファイルの一括移動API
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

  // 複数ファイル/フォルダの一括削除API
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

  // 複数ファイルへのタグ一括追加API
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

  // 単一ファイルの移動API
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

  // 特定パスのタグ情報の更新API
  app.post("/api/tags", (req, res) => {
    const { path: subPath, tags } = req.body;
    if (!subPath || !tags) return res.status(400).json({ error: "パスとタグが必要です" });

    const decodedSubPath = decodeURIComponent(subPath);
    const metadata = getMetadata();
    metadata[decodedSubPath] = tags;
    saveMetadata(metadata);

    res.json({ message: "タグを更新しました" });
  });

  // 単一ファイルの削除API
  app.delete("/api/delete", (req, res) => {
    const { path: subPath } = req.body;
    if (!subPath) return res.status(400).json({ error: "パスが必要です" });

    const decodedSubPath = decodeURIComponent(subPath);
    const fullPath = path.join(IMAGES_DIR, decodedSubPath);

    const absoluteImagesDir = path.resolve(IMAGES_DIR);
    const absoluteFullPath = path.resolve(fullPath);

    // OS間におけるパス構造の差異を許容する安全圏内チェック
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

  // ディレクトリの削除API (配下アセット・メタデータ含む)
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

  // 新規ディレクトリ作成API
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

  // 画像・アセット用静的リソース配信
  app.use("/raw-images", express.static(IMAGES_DIR));

  // 開発・プロダクションに応じたフロントエンド静的リソース配信ミドルウェア
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