import { BrowserRouter, Routes, Route, useLocation, useNavigate, Link } from "react-router-dom";
import React, { useEffect, useState, useRef, useMemo, useCallback, useDeferredValue } from "react";
import { Folder, Folders, ChevronRight, Home, ArrowLeft, Loader2, FileImage, Film, Upload, Trash2, FolderPlus, Play, X, Pencil, Maximize2, Minimize2, Search, Tag, Plus, HelpCircle, FolderInput, Check, CheckSquare } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Item {
  name: string;
  isDirectory: boolean;
  path: string;
  isImage: boolean;
  tags?: string[];
  items?: Item[]; // for group view
  parentTags?: string[];
  folderPreviews?: string[];
  hasSubDirectories?: boolean;
}

interface DirectoryResponse {
  type: "directory";
  items: Item[];
  popularTags: { tag: string; count: number }[];
  prevPath: string | null;
  nextPath: string | null;
  currentTags?: string[];
}

interface FileResponse {
  type: "file";
  name: string;
  path: string;
  isImage: boolean;
  tags?: string[];
  parentTags?: string[];
  prevPath: string | null;
  nextPath: string | null;
}

// 簡易的なマークダウンレンダラー
const MarkdownContent = ({ content }: { content: string }) => {
  const parseInline = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-bold text-zinc-900">{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="bg-zinc-100 px-1.5 py-0.5 rounded text-sm font-mono text-blue-600">{part.slice(1, -1)}</code>;
      return part;
    });
  };

  return (
    <div className="prose prose-zinc max-w-none text-zinc-600">
      {content.split('\n').map((line, i) => {
        if (line.startsWith('# ')) return <h1 key={i} className="text-3xl font-extrabold text-zinc-900 mb-6 mt-8 border-b border-zinc-200 pb-3">{line.slice(2)}</h1>;
        if (line.startsWith('## ')) return <h2 key={i} className="text-xl font-bold text-zinc-900 mb-4 mt-8 flex items-center gap-2">{line.slice(3)}</h2>;
        if (line.startsWith('### ')) return <h3 key={i} className="text-lg font-bold text-zinc-800 mb-3 mt-6">{line.slice(4)}</h3>;
        if (line.startsWith('- ')) return <li key={i} className="ml-5 list-disc mb-2 pl-1 leading-relaxed">{parseInline(line.slice(2))}</li>;
        if (/^\d+\./.test(line)) return <li key={i} className="ml-5 list-decimal mb-2 pl-1 leading-relaxed">{parseInline(line.replace(/^\d+\.\s+/, ''))}</li>;
        if (line.trim() === '') return <div key={i} className="h-2" />;
        return <p key={i} className="mb-4 leading-relaxed">{parseInline(line)}</p>;
      })}
    </div>
  );
};

type BrowseResponse = DirectoryResponse | FileResponse;

// 動画ファイル判定
const isVideoFile = (filename: string) => {
  return /\.(mp4|webm|ogg|mov)$/i.test(filename);
};

// 全角数字を半角に変換するユーティリティ
const toHalfWidth = (val: string | number) => {
  return String(val).replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0));
};

// パスの安全なデコードと正規化（Windows環境のバックスラッシュ対応）
const normalizePath = (path: string) => {
  if (!path) return "";
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // デコード失敗時はそのまま
  }
  return decoded.replace(/\\/g, '/').replace(/\/+/g, '/');
};

// エラー境界コンポーネント
interface ErrorBoundaryProps {
  children: React.ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) { }

  render() {
    if ((this as any).state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-red-50 text-red-800 p-8">
          <h1 className="text-2xl font-bold mb-4">エラーが発生しました</h1>
          <p className="text-lg mb-2">アプリケーションの表示中に問題が発生しました。</p>
          <p className="font-mono text-sm bg-red-100 p-3 rounded break-all">{(this as any).state.error?.message || "不明なエラー"}</p>
          <button onClick={() => window.location.reload()} className="mt-6 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">ページを再読み込み</button>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

function PathExplorer() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [slideshowRange, setSlideshowRange] = useState<{ start: string | number; end: string | number }>({ start: 1, end: 10 });
  const [slideshowPaths, setSlideshowPaths] = useState<string[]>([]);
  const [intervalSeconds, setIntervalSeconds] = useState<string | number>(3);
  const [timeLeft, setTimeLeft] = useState(3);
  const scrollPositions = useRef<Record<string, number>>({});
  const [isZoomed, setIsZoomed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagQuery, setTagQuery] = useState<string[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [readmeText, setReadmeText] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isMovingFile, setIsMovingFile] = useState(false);
  const [allFoldersForMove, setAllFoldersForMove] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [isBulkMoving, setIsBulkMoving] = useState(false);
  const [isAddingBulkTag, setIsAddingBulkTag] = useState(false);
  const sortBy = "extension";

  const navigateTo = useCallback((path: string | null, dir: number) => {
    if (path) {
      // スワイプや前後移動の際は移動先のスクロール位置をリセットする
      scrollPositions.current[path] = 0;
      setDirection(dir);
      navigate(path);
    }
  }, [navigate]);

  const loadPathContent = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);
    try {
      let url = `/api/browse${currentPath}`;

      const isFile = /\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|ogg|mov)$/i.test(currentPath);

      // タグが選択されており、かつフォルダを開こうとしている場合のみタグ検索APIを使用
      if (currentPath.startsWith('/group-view/')) {
        const groupPath = currentPath.replace('/group-view', '');
        url = `/api/browse${groupPath}?recursive=true`;
      } else if (tagQuery.length > 0 && !isFile) {
        const tagsParam = encodeURIComponent(tagQuery.join(","));
        url = `/api/search-by-tag?tag=${tagsParam}&dir=${encodeURIComponent(currentPath)}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("データの取得に失敗しました");
      }
      const json = await response.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentPath, tagQuery]);

  // 一括タグ付けメニューが閉じられた時の処理
  const prevIsAddingBulkTag = useRef(isAddingBulkTag);
  useEffect(() => {
    if (prevIsAddingBulkTag.current === true && isAddingBulkTag === false) {
      setSelectedPaths(new Set());
    }
    prevIsAddingBulkTag.current = isAddingBulkTag;
  }, [isAddingBulkTag, loadPathContent]);

  // ズーム時は背景のスクロールを無効化
  useEffect(() => {
    if (isZoomed) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => { document.body.style.overflow = "unset"; };
  }, [isZoomed]);

  // 検索クエリの更新を低優先度にしてタイピングの引っかかりを防止
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const deferredTagQuery = useDeferredValue(tagQuery);

  // 並べ替え済みのアイテムリスト
  const sortedItems = useMemo(() => {
    if (!data || data.type !== "directory") return [];

    let filtered = data.items;

    // 名前・パス・タグの部分一致検索
    if (deferredSearchQuery) {
      const q = deferredSearchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q) ||
        item.tags?.some(tag => tag.toLowerCase().includes(q))
      );
    }

    // タグのAND検索（すでにタグ検索APIで絞り込み済みの場合はスキップ）
    const targetTagsLower = deferredTagQuery.map(t => t.toLowerCase());
    const isAlreadyFilteredByApi = deferredTagQuery.length > 0 && data.items.some(item => 
      (item.parentTags || []).some(pt => targetTagsLower.includes((pt || '').toLowerCase()))
    );

    if (deferredTagQuery.length > 0 && !isAlreadyFilteredByApi) {
      filtered = filtered.filter(item => {
        const itemAllTagsLower = [
          ...(item.tags || []),
          ...(item.parentTags || [])
        ].map(t => (t || '').toLowerCase());

        return targetTagsLower.every(tq => itemAllTagsLower.includes(tq));
      });
    }

    // タグ検索結果をグループ化する
    if (deferredTagQuery.length > 0) {
      const groups = new Map<string, Item[]>();
      const nonGroupedItems: Item[] = [];

      filtered.forEach(item => {
        const pathParts = item.path.split('/').filter(Boolean);
        // 孫フォルダ (例: /comics/one-piece-vol1) をグループ単位とする
        if (pathParts.length > 2) {
          const groupPath = `/${pathParts.slice(0, 2).join('/')}`;
          if (!groups.has(groupPath)) {
            groups.set(groupPath, []);
          }
          groups.get(groupPath)?.push(item);
        } else {
          // グループ化の対象外のアイテムはそのまま保持
          nonGroupedItems.push(item);
        }
      });

      const groupedItems: Item[] = Array.from(groups.entries()).map(([groupPath, items]) => {
        const firstItem = items[0];
        return {
          name: groupPath.split('/').pop() || groupPath,
          path: groupPath,
          isDirectory: true,
          isImage: false, // グループなので画像ではない
          folderPreviews: items.slice(0, 4).map(i => i.path),
          hasSubDirectories: false, // グループ内のサブディレクトリは考慮しない
          // グループ内のアイテムが持つタグを集約して表示用にセット
          tags: [...new Set(items.flatMap(i => i.tags || []))].slice(0, 2),
          parentTags: [...new Set(items.flatMap(i => i.parentTags || []))].slice(0, 2 - (firstItem.tags?.length || 0)),
        };
      });
      // グループ化されたアイテムと、されなかったアイテムを結合
      filtered = [...groupedItems, ...nonGroupedItems];
    }

    // ソート用の比較値を事前計算してキャッシュ
    const sortPrepared = filtered.map(item => ({
      item,
      ext: item.isDirectory ? "" : (item.name.split(".").pop()?.toLowerCase() || "")
    }));

    return sortPrepared.sort((a, b) => {
      if (a.item.isDirectory !== b.item.isDirectory) return a.item.isDirectory ? -1 : 1;
      if (sortBy === "extension" && a.ext !== b.ext) return a.ext.localeCompare(b.ext);
      return a.item.name.localeCompare(b.item.name, undefined, { numeric: true, sensitivity: 'base' });
    }).map(entry => entry.item);
  }, [data, sortBy, deferredSearchQuery, deferredTagQuery]);

  const sortedMediaItems = useMemo(() => {
    return sortedItems.filter(item => item.isImage || isVideoFile(item.name));
  }, [sortedItems]);

  // フォルダ読み込み時やフィルタリング時に、スライドショーの範囲を現在のアイテム数に合わせる
  useEffect(() => {
    if (!isPlaying && data?.type === "directory") {
      setSlideshowRange({
        start: 1,
        end: sortedMediaItems.length || 1
      });
    }
  }, [data?.type, sortedMediaItems.length, isPlaying]);

  // フィルタリング後のアイテムから、次に絞り込み可能なタグを抽出する
  const filteredPopularTags = useMemo(() => {
    if (data?.type !== "directory") return [];

    // 検索語句または選択タグによる絞り込みが行われている場合、現在の表示アイテムからタグを再集計する
    if (deferredSearchQuery || deferredTagQuery.length > 0) {
      const counts: Record<string, number> = {};
      sortedItems.forEach(item => {
        // 1つのアイテムに対して重複カウントしないよう Set を使用
        const itemAllTags = new Set([...(item.tags || []), ...(item.parentTags || [])]);
        itemAllTags.forEach(tag => {
          if (tag) counts[tag] = (counts[tag] || 0) + 1;
        });
      });

      const q = deferredSearchQuery.toLowerCase();
      return Object.entries(counts)
        .map(([tag, count]) => ({ tag, count }))
        .filter(({ tag }) => !q || tag.toLowerCase().includes(q))
        .sort((a, b) => (b.count || 0) - (a.count || 0) || a.tag.localeCompare(b.tag));
    }

    return data.popularTags || [];
  }, [data, sortedItems, deferredSearchQuery, deferredTagQuery]);

  // スクロール位置の保存

  const startSlideshow = useCallback(() => {
    if (!data || data.type !== "directory") return;

    const paths = sortedMediaItems.map(item => item.path);
    if (paths.length === 0) return;

    const startNum = parseInt(toHalfWidth(slideshowRange.start));
    const endNum = parseInt(toHalfWidth(slideshowRange.end));
    const intervalNum = parseInt(toHalfWidth(intervalSeconds));

    if (isNaN(startNum) || isNaN(endNum) || isNaN(intervalNum)) {
      alert("開始位置、終了位置、または秒数を数値で入力してください。");
      return;
    }

    const maxItems = sortedMediaItems.length;
    if (startNum < 1 || startNum > maxItems || endNum < 1 || endNum > maxItems) {
      alert(`範囲は 1 から ${maxItems} の間で指定してください。`);
      return;
    }

    if (startNum >= endNum) {
      alert("終了位置は開始位置より後である必要があります。");
      return;
    }

    setSlideshowPaths(paths);
    setIsPlaying(true);
    setIsZoomed(true);
    const startIdx = Math.max(0, Math.min(startNum - 1, paths.length - 1));
    navigateTo(paths[startIdx], 1);
  }, [data, sortedMediaItems, slideshowRange, intervalSeconds, navigateTo]);

  const startSlideshowForSelected = useCallback(() => {
    if (!data || data.type !== "directory") return;

    const paths = sortedMediaItems
      .filter(item => selectedPaths.has(item.path))
      .map(item => item.path);

    if (paths.length === 0) {
      alert("スライドショー可能なメディアが選択されていません。");
      return;
    }

    setSlideshowPaths(paths);
    setIsPlaying(true);
    setIsZoomed(true);
    navigateTo(paths[0], 1);
  }, [data, sortedMediaItems, selectedPaths, navigateTo]);

  useEffect(() => {
    const handleScroll = () => {
      // 読み込み中は位置を上書きしない
      if (loading || !data) return;
      scrollPositions.current[location.pathname] = window.scrollY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      if (!loading && data) {
        scrollPositions.current[location.pathname] = window.scrollY;
      }
      window.removeEventListener("scroll", handleScroll);
    };
  }, [location.pathname, loading, data]);

  // ページ移動・ロード完了時にスクロール位置を復元
  useEffect(() => {
    if (!loading && data) {
      const savedPosition = scrollPositions.current[currentPath] || 0;
      // DOMの更新を待つため setTimeout を使用
      const timeoutId = setTimeout(() => {
        window.scrollTo({
          top: savedPosition,
          behavior: "instant",
        });
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [loading, data, currentPath]);

  // キーボードによる前後移動
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "ArrowLeft" && data?.prevPath) {
        navigateTo(data.prevPath, -1);
      } else if (e.key === "ArrowRight" && data?.nextPath) {
        navigateTo(data.nextPath, 1);
      } else if (e.key === "Escape") {
        if (isZoomed) {
          setIsZoomed(false);
        } else if (data?.type === "file") {
          const parentPath = currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
          setIsPlaying(false);
          navigate(parentPath);
        }
      } else if (e.key === " ") {
        e.preventDefault();
        if (data?.type === "directory") {
          startSlideshow();
        } else {
          setIsPlaying(!isPlaying);
        }
      } else if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key.toLowerCase() === "h") {
        setIsPlaying(false);
        navigate("/");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [data, navigateTo, isZoomed, currentPath, navigate, isPlaying, startSlideshow]);

  // ページが切り替わった際の状態リセット
  useEffect(() => {
    const interval = typeof intervalSeconds === 'number' ? intervalSeconds : (parseInt(toHalfWidth(intervalSeconds)) || 3);
    setTimeLeft(interval);
    setIsAddingTag(false);
    setIsMovingFile(false);
    setIsAddingBulkTag(false);
    setTagInput("");
    setSelectedPaths(new Set());
    if (!isPlaying) {
      setIsZoomed(false);
    }
  }, [currentPath, intervalSeconds, isPlaying, setSelectedPaths]);

  // スライドショーのタイマー処理
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    if (isPlaying && !loading) {
      if (data?.type === "file") {
        const dataPathNorm = normalizePath(data.path);
        const currentNorm = normalizePath(currentPath);

        if (dataPathNorm !== currentNorm) return;

        const isVideo = isVideoFile(data.name);
        const currentIndex = slideshowPaths.findIndex(p => normalizePath(p) === dataPathNorm);
        const end = parseInt(String(slideshowRange.end)) || slideshowPaths.length;
        const targetEndIndex = Math.min(end - 1, slideshowPaths.length - 1);

        if (currentIndex !== -1 && currentIndex <= targetEndIndex) {
          if (!isVideo) {
            timer = setInterval(() => {
              setTimeLeft((prev) => prev - 1);
            }, 1000);
          }
        } else {
          setIsPlaying(false);
        }
      }
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, loading, data, slideshowPaths, slideshowRange.end, currentPath]);

  // カウントダウン完了時のスライド遷移処理
  useEffect(() => {
    if (isPlaying && timeLeft <= 0 && data?.type === "file") {
      const dataPathNorm = normalizePath(data.path);
      const currentNorm = normalizePath(currentPath);

      if (dataPathNorm !== currentNorm) return;

      const currentIndex = slideshowPaths.findIndex(p => normalizePath(p) === dataPathNorm);
      const end = parseInt(String(slideshowRange.end)) || slideshowPaths.length;
      const targetEndIndex = Math.min(end - 1, slideshowPaths.length - 1);

      if (currentIndex !== -1) {
        if (currentIndex < targetEndIndex) {
          navigateTo(slideshowPaths[currentIndex + 1], 1);
        } else {
          const start = parseInt(String(slideshowRange.start)) || 1;
          const startIdx = Math.max(0, Math.min(start - 1, slideshowPaths.length - 1));
          navigateTo(slideshowPaths[startIdx], 1);
        }
      }
    }
  }, [timeLeft, isPlaying, data, slideshowPaths, slideshowRange, navigateTo]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    // multerの仕様のため、fileより先にpathをFormDataに追加する
    formData.append("path", currentPath);
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("アップロードに失敗しました");

      const refreshResponse = await fetch(`/api/browse${currentPath}`);
      const json = await refreshResponse.json();
      setData(json);

      if (confirm("アップロードに成功しました。アップロードしたファイルを表示しますか？")) {
        const newPath = (currentPath === "/" ? "" : currentPath) + "/" + encodeURIComponent(file.name);
        navigate(newPath);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // location.state経由でスライドショーが開始された場合の処理
  useEffect(() => {
    const slideshowFromState = location.state?.slideshow;
    if (slideshowFromState) {
      setSlideshowPaths(slideshowFromState.paths);
      setIntervalSeconds(slideshowFromState.interval);
      setSlideshowRange(slideshowFromState.range);
      setIsPlaying(true);
      setIsZoomed(true);
      navigateTo(slideshowFromState.paths[0], 1);
      // 状態を消費したのでクリアする
      // navigateTo を使うと direction がセットされてしまうので、ここでは navigate を直接使う
      navigate(location.pathname, { replace: true, state: {} });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const handleRenameDirectory = async () => {
    if (!data || data.type !== "directory" || currentPath === "/") return;

    const dirName = currentPath.substring(currentPath.lastIndexOf("/") + 1);
    const newName = prompt("フォルダ名の変更");
    if (!newName || newName.trim() === "" || newName === dirName) return;

    try {
      const response = await fetch("/api/renameFolder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: currentPath, newName: newName.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "名前の変更に失敗しました");
      }

      const parentPath = currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
      const newPath = (parentPath === "/" ? "" : parentPath) + "/" + encodeURIComponent(newName.trim());

      navigate(newPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : "名前の変更に失敗しました");
    }
  };

  const handleDeleteDirectory = async () => {
    if (!data || data.type !== "directory" || currentPath === "/") return;

    const isNotEmpty = data.items.length > 0;
    const message = isNotEmpty
      ? "このフォルダは空ではありませんが、削除してもよろしいですか？"
      : "このフォルダを削除しますか？";

    if (!confirm(message)) return;

    try {
      const response = await fetch("/api/delete-dir", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPath }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "削除に失敗しました");
      }

      const parentPath = currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
      navigate(parentPath);
      alert("フォルダを削除しました");
    } catch (err) {
      alert(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  const handleDelete = async () => {
    if (!data || data.type !== "file") return;

    if (!confirm(`このファイルを削除してもよろしいですか？ "${data.name}"`)) return;

    try {
      const response = await fetch("/api/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: data.path }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "削除に失敗しました");
      }

      const parentPath = currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
      navigate(parentPath);
      alert("ファイルを削除しました");
    } catch (err) {
      alert(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  const toggleSelection = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    const newSet = new Set(selectedPaths);
    if (newSet.has(path)) {
      newSet.delete(path);
    } else {
      newSet.add(path);
    }
    setSelectedPaths(newSet);
  };

  const handleSelectAll = () => {
    if (!data || data.type !== "directory") return;

    const allVisiblePaths = sortedItems.map(item => item.path);
    const isAllSelected = allVisiblePaths.length > 0 &&
      allVisiblePaths.every(p => selectedPaths.has(p));

    if (isAllSelected) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(allVisiblePaths));
    }
  };

  const moveFileTo = async (dest: string) => {
    const currentDir = data?.type === "file"
      ? currentPath.substring(0, currentPath.lastIndexOf("/")) || "/"
      : currentPath;

    if (dest === currentDir) {
      setIsMovingFile(false);
      return;
    }

    try {
      if (isBulkMoving) {
        const response = await fetch("/api/bulk-move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: Array.from(selectedPaths), destDir: dest }),
        });
        if (!response.ok) throw new Error("一括移動に失敗しました");

        const refreshResponse = await fetch(`/api/browse${currentPath}`);
        const json = await refreshResponse.json();
        setData(json);
        setSelectedPaths(new Set());
        setIsMovingFile(false);
      } else {
        if (!data || data.type !== "file") return;
        const response = await fetch("/api/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: data.path, destDir: dest }),
        });
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "移動に失敗しました");
        }
        const result = await response.json();
        setIsMovingFile(false);
        navigate(result.newPath);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "移動に失敗しました");
    }
  };

  const handleMoveFile = async () => {
    if (!data || data.type !== "file") return;
    try {
      setIsBulkMoving(false);
      const res = await fetch("/api/all-folders");
      if (!res.ok) throw new Error("フォルダ一覧の取得に失敗しました");
      const folders: string[] = await res.json();
      setAllFoldersForMove(folders);
      setIsMovingFile(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "ファイルの移動に失敗しました");
    }
  };

  const handleMoveSelected = async () => {
    if (selectedPaths.size === 0) return;
    try {
      setIsBulkMoving(true);
      const res = await fetch("/api/all-folders");
      if (!res.ok) throw new Error("フォルダ一覧の取得に失敗しました");
      const folders: string[] = await res.json();
      setAllFoldersForMove(folders);
      setIsMovingFile(true);
    } catch (err) {
      alert("フォルダ一覧の取得に失敗しました");
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedPaths.size === 0) return;
    if (!confirm(`選択した ${selectedPaths.size} 個のアイテムを削除してもよろしいですか？`)) return;

    try {
      const response = await fetch("/api/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: Array.from(selectedPaths) }),
      });

      if (!response.ok) throw new Error("一括削除に失敗しました");

      const refreshResponse = await fetch(`/api/browse${currentPath}`);
      const json = await refreshResponse.json();
      setData(json);
      setSelectedPaths(new Set());
      alert("選択したアイテムを削除しました");
    } catch (err) {
      alert(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  const performBulkTag = async (tagName: string) => {
    const tag = tagName.trim();
    if (!tag) return;

    try {
      const response = await fetch("/api/bulk-add-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: Array.from(selectedPaths), tag }),
      });

      if (!response.ok) throw new Error("一括タグ付けに失敗しました");

      setData(prev => {
        setTagInput("");
        if (!prev || prev.type !== "directory") return prev;
        const updatedItems = prev.items.map(item => {
          if (selectedPaths.has(item.path)) {
            const tags = item.tags || [];
            return { ...item, tags: tags.includes(tag) ? tags : [...tags, tag] };
          }
          return item;
        });
        return { ...prev, items: updatedItems };
      });

      const tagsRes = await fetch("/api/all-tags");
      if (tagsRes.ok) {
        setAllTags(await tagsRes.json());
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "タグ付けに失敗しました");
    }
  };

  const handleTagSelected = async () => {
    if (selectedPaths.size === 0) return;
    if (isAddingBulkTag) {
      setIsAddingBulkTag(false);
      return;
    }

    try {
      const response = await fetch("/api/all-tags");
      const tags = response.ok ? await response.json() : [];
      setAllTags(tags);
      setTagInput("");
    } catch (err) {
      setAllTags([]);
    } finally {
      setIsAddingBulkTag(true);
    }
  };

  const handleRename = async () => {
    if (!data || data.type !== "file") return;

    const newName = prompt("ファイル名の変更", data.name);
    if (!newName || newName.trim() === "" || newName === data.name) return;

    try {
      const response = await fetch("/api/renameFile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: data.path, newName: newName.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "名前の変更に失敗しました");
      }

      const parentPath = currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
      const newPath = (parentPath === "/" ? "" : parentPath) + "/" + encodeURIComponent(newName.trim());

      setIsPlaying(false);
      navigate(newPath);
    } catch (err) {
      alert(err instanceof Error ? err.message : "名前の変更に失敗しました");
    }
  };

  const addTag = async (tagName: string) => {
    if (!data) return;

    const newTag = tagName.trim();
    if (newTag === "") return;

    const targetPath = data.type === "file" ? data.path : currentPath;
    const currentTags = (data.type === "file" ? data.tags : data.currentTags) || [];

    if (currentTags.some(t => t.toLowerCase() === newTag.toLowerCase())) {
      alert("そのタグは既に存在します。");
      setIsAddingTag(false);
      return;
    }

    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath, tags: [...currentTags, newTag] }),
      });

      if (!response.ok) throw new Error("タグの更新に失敗しました");

      setData(prev => {
        if (!prev) return prev;
        if (prev.type === "file") {
          return { ...prev, tags: [...currentTags, newTag] };
        } else {
          return { ...prev, currentTags: [...currentTags, newTag] };
        }
      });
      setTagInput("");
      setIsAddingTag(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "タグの追加に失敗しました");
    }
  };

  const handleAddTag = async () => {
    if (isAddingTag) {
      setIsAddingTag(false);
      return;
    }

    try {
      const response = await fetch("/api/all-tags");
      const tags = response.ok ? await response.json() : [];
      setAllTags(tags);
      setTagInput("");
    } catch (err) {
      setAllTags([]);
    } finally {
      setIsAddingTag(true);
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!data) return;

    if (!confirm(`タグ "${tagToRemove}" を削除しますか？`)) return;

    const targetPath = data.type === "file" ? data.path : currentPath;
    const currentTags = (data.type === "file" ? data.tags : data.currentTags) || [];
    const newTags = currentTags.filter(t => t !== tagToRemove);

    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath, tags: newTags }),
      });

      if (!response.ok) throw new Error("タグの削除に失敗しました");

      setData(prev => {
        if (!prev) return prev;
        if (prev.type === "file") {
          return { ...prev, tags: newTags };
        } else {
          return { ...prev, currentTags: newTags };
        }
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "タグの削除に失敗しました");
    }
  };

  const handleCreateDirectory = async () => {
    const name = prompt("フォルダ名を入力");
    if (!name || name.trim() === "") return;

    try {
      const response = await fetch("/api/mkdir", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: currentPath, name: name.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "フォルダの作成に失敗しました");
      }

      const refreshResponse = await fetch(`/api/browse${currentPath}`);
      const json = await refreshResponse.json();
      setData(json);
    } catch (err) {
      alert(err instanceof Error ? err.message : "フォルダの作成に失敗しました");
    }
  };

  useEffect(() => {
    loadPathContent();
  }, [loadPathContent, tagQuery]);

  useEffect(() => {
    const fetchReadme = async () => {
      try {
        const res = await fetch("/README.md");
        if (res.ok) {
          const text = await res.text();
          setReadmeText(text);
        }
      } catch (err) { /* ignore */ }
    };
    fetchReadme();
  }, []);

  const breadcrumbs = currentPath.split("/").filter(Boolean);

  const swipeConfidenceThreshold = 10000;
  const swipePower = (offset: number, velocity: number) => {
    return Math.abs(offset) * velocity;
  };

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 1000 : -1000,
      opacity: 0
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 1000 : -1000,
      opacity: 0
    })
  };

  const renderContent = () => {
    if (!data) return null;

    if (data.type === "file") {
      const parentPath = currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
      const isVideo = isVideoFile(data.name);

      return (
        <div
          key={`file-${data.path}`}
          className="max-w-6xl mx-auto p-4 md:p-8"
        >
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => {
                setIsPlaying(false);
                navigate(parentPath);
              }}
              className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 transition-colors group"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              フォルダに戻る
            </button>

            <div className="flex items-center gap-3">
              {isPlaying && (
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-600 text-white rounded-full text-[10px] font-bold uppercase shadow-sm">
                  <div className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
                  {isVideo ? "動画を再生中" : `あと ${timeLeft}秒`}
                </div>
              )}
            </div>
          </div>

          <motion.div
            key={data.path}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: "spring", stiffness: 300, damping: 30 },
              opacity: { duration: 0.2 }
            }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={1}
            onDragEnd={(e, { offset, velocity }) => {
              const swipe = swipePower(offset.x, velocity.x);
              if (swipe < -swipeConfidenceThreshold && data.nextPath) {
                setIsPlaying(false);
                navigateTo(data.nextPath, 1);
              } else if (swipe > swipeConfidenceThreshold && data.prevPath) {
                setIsPlaying(false);
                navigateTo(data.prevPath, -1);
              }
            }}
            className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden cursor-grab active:cursor-grabbing"
          >
            <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
              <div className="flex items-center gap-3 truncate pr-4">
                <h2 className="font-semibold text-zinc-900 truncate">{data.name}</h2>
                {isPlaying && (
                  <button
                    onClick={() => setIsPlaying(false)}
                    className="flex items-center gap-1 px-2 py-1 bg-zinc-100 hover:bg-zinc-200 rounded text-[10px] font-bold text-zinc-600 transition-colors"
                    title="スライドショーを停止"
                  >
                    <X className="w-3 h-3" />
                    停止
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleRename}
                  className="p-2 bg-zinc-100 hover:bg-zinc-200 rounded-full transition-colors flex items-center justify-center"
                  title="ファイル名を変更"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <a
                  href={`/raw-images${data.path}`}
                  download
                  className="p-2 bg-zinc-100 hover:bg-zinc-200 rounded-full transition-colors flex items-center justify-center"
                  title="ファイルを保存"
                >
                  <Upload className="w-3 h-3 rotate-180" />
                </a>
                <button
                  onClick={handleDelete}
                  className="p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-full transition-colors flex items-center justify-center"
                  title="ファイルを削除"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            {data.isImage && (
              <div className="px-4 pb-4 flex flex-wrap gap-2 items-center border-b border-zinc-100">
                <Tag className="w-3.5 h-3.5 text-zinc-400" />
                {data.tags?.map(tag => (
                  <div
                    key={tag}
                    className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-full hover:bg-blue-100 transition-colors"
                  >
                    <span
                      onClick={() => {
                        setTagQuery([tag]);
                        setIsPlaying(false);
                        navigate("/");
                      }}
                      className="cursor-pointer"
                      title={`${tag} で検索してフォルダに戻る`}
                    >
                      {tag}
                    </span>
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="p-0.5 hover:text-red-600 transition-colors border-l border-blue-200 ml-1 pl-1"
                      title="タグを削除"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
                {data.parentTags?.map(tag => (
                  <div
                    key={`parent-${tag}`}
                    className="flex items-center gap-1 px-2 py-0.5 bg-zinc-100 text-zinc-500 text-[10px] font-bold rounded-full"
                    title="親フォルダから継承されたタグ"
                  >
                    <span
                      onClick={() => {
                        setTagQuery([tag]);
                        setIsPlaying(false);
                        navigate(parentPath);
                      }}
                      className="cursor-pointer hover:text-zinc-700"
                    >
                      {tag}
                    </span>
                  </div>
                ))}
                <div className="relative">
                  <button
                    onClick={handleAddTag}
                    className={`p-1 rounded-full transition-colors ${isAddingTag ? 'bg-blue-100 text-blue-600' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'}`}
                    title="タグを追加"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  {isAddingTag && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsAddingTag(false)} />
                      <div className="absolute top-full left-0 mt-2 z-50 bg-white border border-zinc-200 rounded-xl shadow-xl p-2 w-48 max-h-60 overflow-auto">
                        <div className="px-1 pb-1 border-b border-zinc-100 mb-1">
                          <input
                            type="text"
                            autoFocus
                            placeholder="新規タグを入力..."
                            className="w-full px-2 py-1.5 text-xs outline-none bg-zinc-50 border border-zinc-200 rounded focus:border-blue-500 transition-colors"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                addTag(tagInput);
                              }
                            }}
                          />
                        </div>
                        {allTags.filter(t => !(data.tags || []).includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())).length === 0 && (
                          <div className="px-3 py-2 text-[10px] text-zinc-400 italic">既存のタグはありません</div>
                        )}
                        {allTags.filter(t => !(data.tags || []).includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())).map(tag => (
                          <button
                            key={tag}
                            onClick={() => addTag(tag)}
                            className="w-full text-left px-3 py-1.5 hover:bg-zinc-50 rounded-lg text-xs text-zinc-700 truncate"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="bg-zinc-50 flex items-center justify-center min-h-[400px] md:min-h-[600px] p-4 overflow-hidden">
              {isVideo ? (
                <video
                  src={`/raw-images${data.path}`}
                  controls
                  autoPlay
                  loop={!isPlaying}
                  onEnded={() => {
                    if (isPlaying) setTimeLeft(0);
                  }}
                  className="max-w-full max-h-[80vh] shadow-2xl rounded-lg"
                />
              ) : data.isImage ? (
                <img
                  src={`/raw-images${data.path}`}
                  alt={data.name}
                  onClick={() => setIsZoomed(true)}
                  className="transition-all duration-300 shadow-2xl rounded-lg cursor-zoom-in max-w-full max-h-[80vh] object-contain"
                />
              ) : (
                <div className="flex flex-col items-center text-zinc-400">
                  <FileImage className="w-16 h-16 mb-4 opacity-20" />
                  <p>プレビューを表示できません</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-zinc-100 bg-zinc-50/50 flex justify-center">
              <button
                onClick={handleMoveFile}
                className="flex items-center gap-2 px-6 py-2 bg-white border border-zinc-200 rounded-xl text-sm font-bold text-zinc-700 hover:border-blue-500 hover:text-blue-600 hover:shadow-md transition-all active:scale-95 shadow-sm"
              >
                <FolderInput className="w-4 h-4" />
                別のフォルダへ移動する
              </button>
            </div>
          </motion.div>
        </div>
      );
    }

    const mediaItems = sortedMediaItems;
    const depth = currentPath.split('/').filter(Boolean).length;

    return (
      <div
        key={`dir-${currentPath}`}
        className="min-h-screen bg-zinc-50"
      >
        {/* ヘッダー（固定） */}
        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-zinc-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 py-4 md:px-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
              <div className="flex items-center gap-4 flex-wrap">
                {mediaItems.length > 0 && (
                  <div className="flex items-center gap-1 bg-zinc-100/50 border border-zinc-200 rounded-lg p-1">
                    <div className="flex items-center gap-1.5 px-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={slideshowRange.start}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || /^[0-9０-９]+$/.test(val)) {
                            setSlideshowRange(prev => ({ ...prev, start: val }));
                          }
                        }}
                        className="w-10 text-center text-xs font-semibold bg-white border border-zinc-200 rounded outline-none focus:border-blue-500 py-0.5"
                        title="スライドショー開始位置"
                      />
                      <span className="text-zinc-400 text-xs">-</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={slideshowRange.end}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || /^[0-9０-９]+$/.test(val)) {
                            setSlideshowRange(prev => ({ ...prev, end: val }));
                          }
                        }}
                        className="w-10 text-center text-xs font-semibold bg-white border border-zinc-200 rounded outline-none focus:border-blue-500 py-0.5"
                        title="スライドショー終了位置"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 px-2 border-l border-zinc-200">
                      <span className="text-[10px] uppercase font-bold text-zinc-400 hidden sm:inline">秒</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={intervalSeconds}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '' || /^[0-9０-９]+$/.test(val)) {
                            setIntervalSeconds(val);
                          }
                        }}
                        className="w-10 text-center text-xs font-semibold bg-white border border-zinc-200 rounded outline-none focus:border-blue-500 py-0.5"
                        title="スライドショーの間隔（秒）"
                      />
                    </div>
                    <button
                      onClick={startSlideshow}
                      className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded transition-colors"
                      title="スライドショーを開始"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      開始
                    </button>
                  </div>
                )}
                <button
                  onClick={handleSelectAll}
                  className={`p-2 rounded-lg border transition-all ${selectedPaths.size > 0 ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-zinc-100 border-zinc-200 text-zinc-700 hover:bg-zinc-200'
                    }`}
                  title="表示されているすべてのアイテムを選択/解除"
                >
                  <CheckSquare className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setShowHelp(true)}
                  className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
                  title="使い方（README）を表示"
                >
                  <HelpCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {depth === 2 && (
                  <button
                    onClick={() => navigate(`/group-view${currentPath}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg transition-colors"
                    title="フォルダ内の全画像を一覧表示します"
                  >
                    <Maximize2 className="w-4 h-4" />
                    一覧表示
                  </button>
                )}
                <button
                  className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 border border-zinc-200 rounded-lg text-sm group focus-within:border-blue-500 focus-within:bg-white transition-all"
                >
                  <Search className="w-4 h-4 text-zinc-400 group-focus-within:text-blue-500" />
                  <input
                    type="text"
                    placeholder="名前/タグ"
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-transparent outline-none w-20 sm:w-32 text-zinc-700 placeholder:text-zinc-400"
                  />
                </button>
                {depth < 2 && (
                  <button
                    onClick={handleCreateDirectory}
                    className="p-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg transition-colors border border-zinc-200"
                    title="新しいフォルダを作成"
                  >
                    <FolderPlus className="w-5 h-5" />
                  </button>
                )}
                {currentPath !== "/" && (
                  <button
                    onClick={handleRenameDirectory}
                    className="p-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg transition-colors border border-zinc-200"
                    title="現在のフォルダ名を変更"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                )}
                {currentPath !== "/" && (
                  <button
                    onClick={handleDeleteDirectory}
                    className="p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-colors border border-red-200"
                    title="現在のフォルダを削除"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
                {currentPath !== "/" && (<div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleUpload}
                    className="hidden"
                    accept="image/*,video/*"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="p-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
                    title="画像や動画を追加"
                  >
                    {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                  </button>
                </div>)}
              </div>
            </div>

            <nav className="flex items-center gap-2 text-sm text-zinc-500 bg-white p-2 rounded-lg border border-zinc-100 inline-flex">
              <Link
                to="/"
                onClick={() => { setIsPlaying(false); setSearchQuery(""); setTagQuery([]);; }}
                className="p-1 hover:text-blue-600 transition-colors"
                title="ホームに戻る"
              >
                <Home className="w-4 h-4" />
              </Link>
              {breadcrumbs.map((crumb, i) => {
                const path = "/" + breadcrumbs.slice(0, i + 1).join("/");
                return (
                  <div key={path} className="flex items-center gap-2">
                    <ChevronRight className="w-3 h-3 text-zinc-300" />
                    <Link
                      to={path}
                      onClick={() => {
                        setIsPlaying(false);
                        setSearchQuery("");
                        setTagQuery([]);;
                      }}
                      className={`hover:text-blue-600 transition-colors ${i === breadcrumbs.length - 1 ? 'font-semibold text-zinc-900' : ''}`}
                    >
                      {decodeURIComponent(crumb)}
                    </Link>
                  </div>
                );
              })}
            </nav>

            {data.type === "directory" && currentPath !== "/" && (
              <div className="mt-3 px-1 flex flex-wrap gap-2 items-center">
                <Tag className="w-3.5 h-3.5 text-zinc-400" />
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">フォルダのタグ:</span>
                {data.currentTags?.map(tag => (
                  <div
                    key={tag}
                    className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-full"
                  >
                    <span
                      onClick={() => {
                        setTagQuery([tag]);
                        setIsPlaying(false);
                        navigate("/");
                      }}
                      className="cursor-pointer hover:underline"
                      title={`${tag} で検索してホームに戻る`}
                    >
                      {tag}
                    </span>
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="p-0.5 hover:text-red-600 transition-colors border-l border-blue-200 ml-1 pl-1"
                      title="タグを削除"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
                <div className="relative">
                  <button
                    onClick={handleAddTag}
                    className={`p-1 rounded-full transition-colors ${isAddingTag ? 'bg-blue-100 text-blue-600' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600'}`}
                    title="タグを追加"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  {isAddingTag && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsAddingTag(false)} />
                      <div className="absolute top-full left-0 mt-2 z-50 bg-white border border-zinc-200 rounded-xl shadow-xl p-2 w-48 max-h-60 overflow-auto">
                        <div className="px-1 pb-1 border-b border-zinc-100 mb-1">
                          <input
                            type="text"
                            autoFocus
                            placeholder="新規タグを入力..."
                            className="w-full px-2 py-1.5 text-xs outline-none bg-zinc-50 border border-zinc-200 rounded focus:border-blue-500 transition-colors"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                addTag(tagInput);
                              }
                            }}
                          />
                        </div>
                        {allTags.filter(t => !(data.currentTags || []).includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())).length === 0 && (
                          <div className="px-3 py-2 text-[10px] text-zinc-400 italic">既存のタグはありません</div>
                        )}
                        {allTags.filter(t => !(data.currentTags || []).includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())).map(tag => (
                          <button
                            key={tag}
                            onClick={() => addTag(tag)}
                            className="w-full text-left px-3 py-1.5 hover:bg-zinc-50 rounded-lg text-xs text-zinc-700 truncate"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {data.type === "directory" && filteredPopularTags.length > 0 && (
              <div className="mt-3 flex items-center gap-3 overflow-x-auto pb-2 scroll-smooth no-scrollbar">
                <div className="flex items-center gap-1.5 text-zinc-400 shrink-0">
                  <Tag className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">タグで絞り込み:</span>
                </div>
                <div className="flex items-center gap-2">
                  {filteredPopularTags.map(({ tag }) => (
                    <button
                      key={tag}
                      onClick={() => setTagQuery(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                      className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all border shadow-sm ${(searchQuery === tag || tagQuery.includes(tag))
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 active:scale-95"
                        }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* コンテンツエリア */}
        <div className="max-w-6xl mx-auto p-4 md:p-8 overflow-x-hidden">
          <motion.div
            key={currentPath}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: "spring", stiffness: 300, damping: 30 },
              opacity: { duration: 0.2 }
            }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.4}
            onDragEnd={(e, { offset, velocity }) => {
              const swipe = swipePower(offset.x, velocity.x);
              if (swipe < -swipeConfidenceThreshold && data.nextPath) {
                setIsPlaying(false);
                navigateTo(data.nextPath, 1);
              } else if (swipe > swipeConfidenceThreshold && data.prevPath) {
                setIsPlaying(false);
                navigateTo(data.prevPath, -1);
              }
            }}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 min-h-[50vh]"
          >
            {sortedItems.map((item, index) => {
              const isVideo = isVideoFile(item.name);
              const mediaIndex = (item.isImage || isVideo)
                ? mediaItems.findIndex(mi => mi.path === item.path) + 1
                : null;
              const isSelected = selectedPaths.has(item.path);
              // 孫フォルダ以降をグループとして扱う
              const isGroup = item.isDirectory && item.path.split('/').filter(Boolean).length > 1;

              return (
                <motion.div
                  key={item.path}
                  whileHover={{ y: -4 }}
                  className="group relative"
                >
                  {/* 選択チェックボックス */}
                  <div
                    onClick={(e) => toggleSelection(e, item.path)}
                    className={`absolute top-2 right-2 z-20 p-1 rounded-full border shadow-md transition-all cursor-pointer ${isSelected
                      ? 'bg-blue-600 border-blue-600 text-white scale-110'
                      : 'bg-white border-zinc-400 text-zinc-400 opacity-40 group-hover:opacity-100 hover:scale-110'
                      }`}
                  >
                    <Check className={`w-3.5 h-3.5 ${isSelected ? 'stroke-[3px]' : ''}`} />
                  </div>
                  <Link
                    onClick={(e) => {
                      if (selectedPaths.size > 0) toggleSelection(e, item.path);
                      if (item.isDirectory && !isGroup) { setSearchQuery(""); setTagQuery([]);; }
                    }}
                    to={selectedPaths.size > 0 ? "" : (isGroup ? `/group-view${item.path}` : item.path)}
                    className="block bg-white border border-zinc-200 rounded-xl overflow-hidden hover:shadow-md hover:border-blue-200 transition-all h-full"
                  >
                    <div className="aspect-square bg-zinc-50 flex items-center justify-center relative overflow-hidden group-hover:bg-blue-50/50 transition-colors">
                      {mediaIndex !== null && (
                        <div className="absolute top-2 left-2 z-20 bg-black/50 text-white text-[10px] font-bold px-1.5 py-0.5 rounded backdrop-blur-sm group-hover:bg-blue-600 transition-colors">
                          {mediaIndex}
                        </div>
                      )}
                      {item.isDirectory && (isGroup || item.folderPreviews) ? (
                        <div className="w-full h-full flex items-center justify-center relative">
                          {item.folderPreviews && item.folderPreviews.length > 0 ? (
                            <>
                              <div className={`grid w-full h-full pointer-events-none transition-transform duration-500 group-hover:scale-110 ${item.folderPreviews.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                                } ${item.folderPreviews.length > 2 ? 'grid-rows-2' : ''}`}>
                                {item.folderPreviews.map((previewPath, i) => {
                                  const isVideoPreview = previewPath.startsWith('video:');
                                  const srcPath = isVideoPreview ? previewPath.substring(6) : previewPath;
                                  return isVideoPreview ? (
                                    <video
                                      key={i}
                                      src={`/raw-images${srcPath}`}
                                      className={`w-full h-full object-cover ${item.folderPreviews?.length === 3 && i === 0 ? 'row-span-2' : ''}`}
                                      muted loop playsInline preload="metadata"
                                    />
                                  ) : (
                                    <img
                                      key={i}
                                      src={`/raw-images${srcPath}`}
                                      alt=""
                                      loading="lazy"
                                      className={`w-full h-full object-cover ${item.folderPreviews?.length === 3 && i === 0 ? 'row-span-2' : ''}`}
                                    />
                                  );
                                })}
                              </div>
                              <div className="absolute bottom-1 right-1 bg-white/70 p-1 rounded backdrop-blur-sm z-10 shadow-sm border border-zinc-200/50">
                                {item.hasSubDirectories ? <Folders className="w-3.5 h-3.5 text-zinc-600" /> : <Folder className="w-3.5 h-3.5 text-zinc-600" />}
                              </div>
                            </>
                          ) : isGroup ? (
                            <Folders className="w-12 h-12 text-zinc-300 group-hover:text-blue-400 group-hover:scale-110 transition-all duration-300" />
                          ) : ( // 通常のフォルダ
                            item.hasSubDirectories ? (
                              <Folders className="w-12 h-12 text-zinc-300 group-hover:text-blue-400 group-hover:scale-110 transition-all duration-300" />
                            ) : (
                              <Folder className="w-12 h-12 text-zinc-300 group-hover:text-blue-400 group-hover:scale-110 transition-all duration-300" />
                            )
                          ) }
                        </div>
                      ) : isVideo ? (
                        <div className="relative w-full h-full bg-black flex items-center justify-center">
                          <video
                            src={`/raw-images${item.path}`}
                            preload="metadata"
                            className="w-full h-full object-cover opacity-60 transition-transform duration-500 group-hover:scale-110 pointer-events-none"
                          />
                          <div className="absolute inset-0 flex items-center justify-center z-10">
                            <Film className="w-10 h-10 text-white drop-shadow-lg group-hover:scale-110 transition-transform duration-300" />
                          </div>
                        </div>
                      ) : item.isImage ? (
                        <img
                          src={`/raw-images${item.path}`}
                          alt={item.name}
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 pointer-events-none"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'https://placehold.co/400?text=No+Preview';
                          }}
                        />
                      ) : item.isDirectory ? ( // プレビューがないフォルダ
                        <Folder className="w-12 h-12 text-zinc-300 group-hover:text-blue-400 group-hover:scale-110 transition-all duration-300" />
                      ) : (
                        <FileImage className="w-10 h-10 text-zinc-200" />
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-xs font-medium text-zinc-700 truncate group-hover:text-blue-600 transition-colors">
                        {item.name}
                      </p>
                      {(item.tags && item.tags.length > 0 || item.parentTags && item.parentTags.length > 0) && (
                        <div className="flex flex-wrap gap-1 mt-1.5 opacity-80">
                          {item.tags?.slice(0, 2).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 bg-zinc-100 text-zinc-500 text-[8px] rounded uppercase font-bold tracking-tight">
                              {tag}
                            </span>
                          ))}
                          {item.parentTags?.slice(0, 2 - (item.tags?.length || 0)).map(tag => (
                            <span key={`parent-${tag}`} className="px-1.5 py-0.5 bg-zinc-100/70 text-zinc-400 text-[8px] rounded uppercase font-bold tracking-tight" title="親フォルダのタグ">
                              {tag}
                            </span>
                          ))}
                          {((item.tags?.length || 0) + (item.parentTags?.length || 0)) > 2 && (
                            <span className="text-[8px] text-zinc-400 font-medium">+{((item.tags?.length || 0) + (item.parentTags?.length || 0)) - 2}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </Link>
                </motion.div>
              );
            })}
            {data.items.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-20 text-zinc-400 bg-zinc-50/50 rounded-2xl border-2 border-dashed border-zinc-100">
                <Folder className="w-12 h-12 mb-4 opacity-10" />
                <p className="text-sm font-medium">このフォルダは空です</p>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    );
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="bg-red-50 text-red-600 p-4 rounded-xl max-w-md">
          <p className="font-semibold">エラーが発生しました</p>
          <p className="text-sm mt-1">{error}</p>
          <button onClick={() => navigate("/")} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg transition-colors hover:bg-red-700">トップへ戻る</button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <AnimatePresence mode="wait" custom={direction}>
        {loading ? (
          <motion.div
            key="loader"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center min-h-[60vh]"
          >
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className="mt-4 text-zinc-500 font-medium">フォルダを読み込み中...</p>
          </motion.div>
        ) : (
          renderContent()
        )}
      </AnimatePresence>

      {/* ヘルプモーダル (README) */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowHelp(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-zinc-100 flex items-center justify-between sticky top-0 bg-white">
                <div className="flex items-center gap-2 text-zinc-900 font-bold">
                  <HelpCircle className="w-5 h-5 text-blue-600" />
                  <span>マニュアル</span>
                </div>
                <button
                  onClick={() => setShowHelp(false)}
                  className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 md:p-10 overflow-auto">
                <div className="mb-12">
                  <h2 className="text-lg font-bold text-zinc-900 mb-4 flex items-center gap-2">
                    <Check className="w-4 h-4 text-blue-600" />
                    キーボードショートカット
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { key: "← / →", desc: "前後のメディアへ移動" },
                      { key: "Esc", desc: "拡大終了 / フォルダへ戻る" },
                      { key: "Space", desc: "再生・一時停止 / 開始" },
                      { key: "/", desc: "検索ボックスへ移動" },
                      { key: "H", desc: "ホームへ戻る" },
                    ].map((item) => (
                      <div key={item.key} className="flex items-center justify-between p-2.5 bg-zinc-50 rounded-lg border border-zinc-100">
                        <span className="text-zinc-600 text-xs font-medium">{item.desc}</span>
                        <kbd className="px-2 py-0.5 bg-white border border-zinc-300 rounded shadow-sm text-[10px] font-mono font-bold text-zinc-800">
                          {item.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-zinc-200 mb-8" />
                {readmeText ? <MarkdownContent content={readmeText} /> : <div className="flex justify-center py-20"><Loader2 className="animate-spin text-zinc-300" /></div>}
              </div>
              <div className="p-4 border-t border-zinc-50 bg-zinc-50 flex justify-end">
                <button
                  onClick={() => {
                    setShowHelp(false);
                    window.location.reload();
                  }}
                  className="px-6 py-2 bg-zinc-900 text-white rounded-xl font-bold text-sm hover:bg-zinc-800 transition-colors"
                >
                  閉じる
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* フォルダ移動モーダル */}
      <AnimatePresence>
        {isMovingFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setIsMovingFile(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[70vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-zinc-100 flex items-center justify-between sticky top-0 bg-white">
                <div className="flex items-center gap-2 text-zinc-900 font-bold">
                  <FolderInput className="w-5 h-5 text-blue-600" />
                  <span>移動先フォルダを選択</span>
                </div>
                <button
                  onClick={() => setIsMovingFile(false)}
                  className="p-2 hover:bg-zinc-100 rounded-full text-zinc-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 overflow-auto space-y-1">
                {allFoldersForMove.map((folderPath) => (
                  <button
                    key={folderPath}
                    onClick={() => moveFileTo(folderPath)}
                    className="w-full text-left px-4 py-3 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all flex items-center gap-3 group border border-transparent hover:border-blue-100"
                  >
                    <Folder className="w-4 h-4 text-zinc-400 group-hover:text-blue-500" />
                    <span className="text-sm font-medium truncate">{folderPath}</span>
                  </button>
                ))}
              </div>
              <div className="p-4 border-t border-zinc-50 bg-zinc-50 flex justify-end">
                <button
                  onClick={() => setIsMovingFile(false)}
                  className="px-6 py-2 bg-zinc-200 text-zinc-700 rounded-xl font-bold text-sm hover:bg-zinc-300 transition-colors"
                >
                  キャンセル
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 一括操作バー */}
      {selectedPaths.size > 0 && (
        <motion.div
          initial={{ y: 100, x: "-50%" }}
          animate={{ y: 0, x: "-50%" }}
          exit={{ y: 100, x: "-50%" }}
          className="fixed bottom-8 left-1/2 z-40 bg-zinc-900 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-6 border border-white/10"
        >
          <div className="text-sm font-bold border-r border-zinc-700 pr-6 flex items-center gap-2">
            <span className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center text-[10px]">{selectedPaths.size}</span>
            選択中
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <button
                onClick={handleTagSelected}
                className={`p-2 transition-colors ${isAddingBulkTag ? 'text-blue-400' : 'hover:text-blue-400'}`}
                title="タグ追加"
              >
                <Tag className="w-4 h-4" />
              </button>
              {isAddingBulkTag && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsAddingBulkTag(false)} />
                  <div className="absolute bottom-full left-0 mb-4 z-50 bg-white border border-zinc-200 rounded-xl shadow-xl p-2 w-48 max-h-60 overflow-auto text-zinc-900">
                    <div className="px-1 pb-1 border-b border-zinc-100 mb-1">
                      <input
                        type="text"
                        autoFocus
                        placeholder="一括タグ追加..."
                        className="w-full px-2 py-1.5 text-xs outline-none bg-zinc-50 border border-zinc-200 rounded focus:border-blue-500 transition-colors text-zinc-900"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            performBulkTag(tagInput);
                          }
                        }}
                      />
                    </div>
                    {allTags.filter(t => t.toLowerCase().includes(tagInput.toLowerCase())).length === 0 && (
                      <div className="px-3 py-2 text-[10px] text-zinc-400 italic">既存のタグはありません</div>
                    )}
                    {allTags.filter(t => t.toLowerCase().includes(tagInput.toLowerCase())).map(tag => (
                      <button
                        key={tag}
                        onClick={() => performBulkTag(tag)}
                        className="w-full text-left px-3 py-1.5 hover:bg-zinc-50 rounded-lg text-xs text-zinc-700 truncate"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={startSlideshowForSelected}
              className="p-2 hover:text-blue-400 transition-colors"
              title="スライドショー"
            >
              <Play className="w-4 h-4" />
            </button>
            <button
              onClick={handleMoveSelected}
              className="p-2 hover:text-blue-400 transition-colors"
              title="移動"
            >
              <FolderInput className="w-4 h-4" />
            </button>
            <button
              onClick={handleDeleteSelected}
              className="p-2 hover:text-red-400 transition-colors"
              title="削除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setSelectedPaths(new Set());
                setIsAddingBulkTag(false);
              }}
              className="p-2 hover:text-zinc-400 transition-colors"
              title="閉じる"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}

      {/* 拡大表示オーバーレイ */}
      <AnimatePresence>
        {isZoomed && data?.type === "file" && data.isImage && (
          <motion.div
            key={`zoom-${data.path}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 md:p-12 cursor-zoom-out"
            onClick={() => setIsZoomed(false)}
          >
            <button
              onClick={(e) => { e.stopPropagation(); setIsZoomed(false); }}
              className="fixed top-6 right-6 z-[60] p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-colors border border-white/20 shadow-xl"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={`/raw-images${data.path}`}
              alt={data.name}
              className="max-w-full max-h-full object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GroupView() {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intervalSeconds, setIntervalSeconds] = useState<string | number>(3);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [addingTagToPath, setAddingTagToPath] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);

  const groupPath = location.pathname.replace('/group-view', '');

  useEffect(() => {
    const loadGroupContent = async () => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/browse${groupPath}?recursive=true`;
        const response = await fetch(url);
        if (!response.ok) throw new Error("グループデータの取得に失敗しました");
        const json = await response.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    loadGroupContent();
  }, [groupPath]);

  const handleAddTag = async (path: string) => {
    if (isAddingTag && addingTagToPath === path) {
      setIsAddingTag(false);
      setAddingTagToPath(null);
      return;
    }
    try {
      const response = await fetch("/api/all-tags");
      const tags = response.ok ? await response.json() : [];
      setAllTags(tags);
      setTagInput("");
    } catch (err) {
      setAllTags([]);
    } finally {
      setIsAddingTag(true);
      setAddingTagToPath(path);
    }
  };

  const addTag = async (tagName: string, path: string) => {
    const newTag = tagName.trim();
    if (newTag === "") return;

    const item = data?.items?.find(i => i.path === path);
    if (!item) return;

    const currentTags = item.tags || [];
    if (currentTags.some(t => t.toLowerCase() === newTag.toLowerCase())) {
      alert("そのタグは既に存在します。");
      return;
    }

    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: path, tags: [...currentTags, newTag] }),
      });
      if (!response.ok) throw new Error("タグの更新に失敗しました");

      setData(prev => {
        if (!prev) return prev;
        const newItems = prev.items.map(i => {
          if (i.path === path) {
            return { ...i, tags: [...(i.tags || []), newTag] };
          }
          return i;
        });
        return { ...prev, items: newItems };
      });
      setTagInput("");
      setIsAddingTag(false);
      setAddingTagToPath(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "タグの追加に失敗しました");
    }
  };

  const handleRemoveTag = async (tagToRemove: string, path: string) => {
    if (!confirm(`タグ "${tagToRemove}" を削除しますか？`)) return;

    const item = data?.items?.find(i => i.path === path);
    if (!item) return;

    const newTags = (item.tags || []).filter(t => t !== tagToRemove);

    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: path, tags: newTags }),
      });
      if (!response.ok) throw new Error("タグの削除に失敗しました");

      setData(prev => {
        if (!prev) return prev;
        const newItems = prev.items.map(i => {
          if (i.path === path) return { ...i, tags: newTags };
          return i;
        });
        return { ...prev, items: newItems };
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "タグの削除に失敗しました");
    }
  };

  const startSlideshow = () => {
    if (!data || !data.items) return;
    const mediaItems = data.items.filter(item => item.isImage || isVideoFile(item.name));
    if (mediaItems.length === 0) return;

    const paths = mediaItems.map(item => item.path);
    const interval = parseInt(toHalfWidth(intervalSeconds), 10);

    // PathExplorerにスライドショーの状態を渡して開始
    navigate(paths[0], {
      state: {
        slideshow: {
          paths: paths,
          interval: isNaN(interval) ? 3 : interval,
          range: { start: 1, end: paths.length }
        }
      }
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <p className="mt-4 text-zinc-500 font-medium">グループを読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="bg-red-50 text-red-600 p-4 rounded-xl max-w-md">
          <p className="font-semibold">エラーが発生しました</p>
          <p className="text-sm mt-1">{error}</p>
          <button onClick={() => navigate("/")} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg transition-colors hover:bg-red-700">トップへ戻る</button>
        </div>
      </div>
    );
  }

  const parentPath = groupPath.substring(0, groupPath.lastIndexOf('/')) || '/';

  return (
    <div className="bg-zinc-800 min-h-screen text-white">
      <div className="sticky top-0 z-30 bg-zinc-900/80 backdrop-blur-md border-b border-white/10 shadow-lg p-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex-1">
            <button
              onClick={() => navigate(parentPath)}
              className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors group"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              フォルダに戻る
            </button>
            <h1 className="text-xl font-bold mt-1 truncate">{decodeURIComponent(groupPath.split('/').pop() || '')}</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(groupPath)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-xs font-bold rounded-lg transition-colors"
              title="通常のフォルダ表示に戻ります"
            >
              <Minimize2 className="w-4 h-4" />
              フォルダとして表示
            </button>

            <div className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700 rounded-lg p-1">
            <div className="flex items-center gap-1.5 px-2 border-r border-zinc-700">
              <span className="text-[10px] uppercase font-bold text-zinc-400">秒</span>
              <input
                type="text"
                inputMode="numeric"
                value={intervalSeconds}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || /^[0-9０-９]+$/.test(val)) {
                    setIntervalSeconds(val);
                  }
                }}
                className="w-10 text-center text-xs font-semibold bg-zinc-900 border border-zinc-700 rounded outline-none focus:border-blue-500 py-0.5"
                title="スライドショーの間隔（秒）"
              />
            </div>
            <button
              onClick={startSlideshow}
              className="flex items-center gap-1.5 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded transition-colors"
              title="スライドショーを開始"
            >
              <Play className="w-3 h-3 fill-current" />
              スライドショー
            </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">
        {data?.items?.filter(item => item.isImage || isVideoFile(item.name)).map(item => (
          <div key={item.path} className="bg-zinc-900 rounded-xl overflow-hidden border border-zinc-700 shadow-2xl">
            <div className="p-3 border-b border-zinc-800">
              <p className="text-sm font-medium text-zinc-300 truncate">{item.name}</p>
            </div>
            {(item.tags && item.tags.length > 0 || item.parentTags && item.parentTags.length > 0) && (
              <div className="p-3 border-b border-zinc-800 flex flex-wrap gap-2 items-center relative">
                <Tag className="w-3.5 h-3.5 text-zinc-400" />
                {item.tags?.map(tag => (
                  <div key={tag} className="flex items-center gap-1 pl-2 pr-1 py-0.5 bg-blue-600/50 text-blue-200 text-[10px] font-bold rounded-full">
                    <span>{tag}</span>
                    <button
                      onClick={() => handleRemoveTag(tag, item.path)}
                      className="p-0.5 hover:text-red-400 transition-colors border-l border-blue-400/50 ml-1 pl-1"
                      title="タグを削除"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
                {item.parentTags?.map(tag => (
                  <span key={`parent-${tag}`} className="px-2 py-0.5 bg-zinc-700/80 text-zinc-400 text-[10px] font-bold rounded-full" title="親フォルダから継承されたタグ">
                    {tag}
                  </span>
                ))}
                <div className="relative">
                  <button
                    onClick={() => handleAddTag(item.path)}
                    className={`p-1 rounded-full transition-colors ${isAddingTag && addingTagToPath === item.path ? 'bg-blue-100/20 text-blue-300' : 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}`}
                    title="タグを追加"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  {isAddingTag && addingTagToPath === item.path && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => { setIsAddingTag(false); setAddingTagToPath(null); }} />
                      <div className="absolute top-full left-0 mt-2 z-50 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl p-2 w-48 max-h-60 overflow-auto">
                        <div className="px-1 pb-1 border-b border-zinc-700 mb-1">
                          <input
                            type="text"
                            autoFocus
                            placeholder="新規タグを入力..."
                            className="w-full px-2 py-1.5 text-xs outline-none bg-zinc-900 border border-zinc-700 rounded focus:border-blue-500 transition-colors text-zinc-200"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                addTag(tagInput, item.path);
                              }
                            }}
                          />
                        </div>
                        {allTags.filter(t => !(item.tags || []).includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())).length === 0 && (
                          <div className="px-3 py-2 text-[10px] text-zinc-500 italic">既存のタグはありません</div>
                        )}
                        {allTags.filter(t => !(item.tags || []).includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())).map(tag => (
                          <button
                            key={tag}
                            onClick={() => addTag(tag, item.path)}
                            className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 rounded-lg text-xs text-zinc-300 truncate"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="bg-black flex items-center justify-center">
              {isVideoFile(item.name) ? (
                <video src={`/raw-images${item.path}`} controls className="max-w-full max-h-[90vh]" />
              ) : (
                <img src={`/raw-images${item.path}`} alt={item.name} className="max-w-full max-h-[90vh] object-contain" />
              )}
            </div>
          </div>
        ))}
        {data?.items?.length === 0 && (
          <div className="text-center py-20 text-zinc-500">
            <p>このグループには表示できるアイテムがありません。</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {

  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <Routes>
          <Route path="/group-view/*" element={
            <ErrorBoundary><GroupView /></ErrorBoundary>
          } />
          <Route path="/*" element={
            <ErrorBoundary><PathExplorer /></ErrorBoundary>
          } />
        </Routes>
      </div>
    </BrowserRouter>
  );
}