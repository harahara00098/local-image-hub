import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import App from './App';

// lucide-reactアイコンがESM制限によりJest環境でエラーを起こすのを防ぐためのプロキシモック
jest.mock('lucide-react', () => {
  return new Proxy({}, {
    get: function (target, prop) {
      return () => <span data-testid={`icon-${String(prop)}`}>{String(prop)}</span>;
    }
  });
});

describe('App', () => {
  beforeEach(() => {
    jest.spyOn(window, 'alert').mockImplementation(() => { });

    global.fetch = jest.fn((url) => {
      // 通常のフォルダブラウズAPI
      if (url === '/api/browse' || url === '/api/browse/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            type: 'directory',
            items: [
              { name: 'image1.jpg', path: '/image1.jpg', isDirectory: false, isImage: true, tags: ['tag1'], parentTags: ['tag2'] },
              { name: 'image2.jpg', path: '/image2.jpg', isDirectory: false, isImage: true, tags: ['tag1'] },
              { name: 'doc.txt', path: '/doc.txt', isDirectory: false, isImage: false },
            ],
            popularTags: [
              { tag: 'tag1', count: 2 },
              { tag: 'tag2', count: 1 }
            ],
            prevPath: null,
            nextPath: null
          }),
        });
      }

      // 単一ファイル表示API
      if (url === '/api/browse/image1.jpg') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            type: 'file',
            name: 'image1.jpg',
            path: '/image1.jpg',
            isImage: true,
            tags: ['tag1'],
            parentTags: ['tag2'],
            prevPath: null,
            nextPath: '/image2.jpg'
          }),
        });
      }

      // タグ検索API
      if (url.includes('/api/search-by-tag')) {
        const urlObj = new URL(url, 'http://localhost');
        const tagParam = decodeURIComponent(urlObj.searchParams.get('tag') || '');
        const tags = tagParam.split(',').filter(Boolean);

        const allItems = [
          { name: 'image1.jpg', path: '/image1.jpg', isDirectory: false, isImage: true, tags: ['tag1'], parentTags: ['tag2'] },
          { name: 'image2.jpg', path: '/image2.jpg', isDirectory: false, isImage: true, tags: ['tag1'] },
        ];

        const filteredItems = allItems.filter(item => {
          const itemTags = [...(item.tags || []), ...(item.parentTags || [])].map(t => t.toLowerCase());
          return tags.every(t => itemTags.includes(t.toLowerCase()));
        });

        const counts: Record<string, number> = {};
        filteredItems.forEach(item => {
          [...(item.tags || []), ...(item.parentTags || [])].forEach(t => {
            counts[t] = (counts[t] || 0) + 1;
          });
        });
        const dynamicPopularTags = Object.entries(counts).map(([tag, count]) => ({ tag, count }));

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            type: 'directory',
            items: filteredItems,
            popularTags: dynamicPopularTags,
            prevPath: null,
            nextPath: null
          })
        });
      }

      if (url === '/README.md') {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('# Test README'),
        });
      }

      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Not Found" }),
      });
    }) as jest.Mock;
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it('renders loading state initially', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByText(/フォルダを読み込み中/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/フォルダを読み込み中/i)).not.toBeInTheDocument();
    });
  });

  it('can start a slideshow for selected items', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('image1.jpg')).toBeInTheDocument();
    });

    const checkIcons = screen.getAllByTestId('icon-Check');
    fireEvent.click(checkIcons[0]);

    const playButton = await screen.findByTitle('スライドショー');
    expect(playButton).toBeInTheDocument();
    fireEvent.click(playButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'image1.jpg' })).toBeInTheDocument();
    });
    expect(screen.getByText(/あと \d+秒/)).toBeInTheDocument();
  });

  it('filters items correctly with multiple tags (AND search)', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('image1.jpg')).toBeInTheDocument();
    });

    const tag1Button = screen.getByRole('button', { name: /tag1:/ });
    fireEvent.click(tag1Button);
    await waitFor(() => {
      expect(screen.queryByText(/フォルダを読み込み中/i)).not.toBeInTheDocument();
    });

    const tag2Button = screen.getByRole('button', { name: /tag2:/ });
    fireEvent.click(tag2Button);

    await waitFor(() => {
      expect(screen.getByText('image1.jpg')).toBeInTheDocument();
      expect(screen.queryByText('image2.jpg')).not.toBeInTheDocument();
    });
  });
});

// 前のテストによるHistory履歴や非同期キャッシュの干渉を防ぐため、スイートを分離
describe('App - Isolation Test', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders items that only match via parentTags (regression test for inherited tags)', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    
    await waitFor(() => {
      expect(screen.queryByText(/フォルダを読み込み中/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText('image1.jpg')).toBeInTheDocument();

    // 前のテストの選択状態（tag1）が残っている場合はクリックして解除
    const activeTag1Button = screen.queryByRole('button', { name: /tag1:/ });
    if (activeTag1Button && activeTag1Button.className.includes('bg-blue-600')) {
      fireEvent.click(activeTag1Button);
      await waitFor(() => {
        expect(screen.queryByText(/フォルダを読み込み中/i)).not.toBeInTheDocument();
      });
    }

    const tag2Button = screen.getByRole('button', { name: /tag2:/ });
    fireEvent.click(tag2Button);

    await waitFor(() => {
      expect(screen.queryByText(/フォルダを読み込み中/i)).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('image1.jpg')).toBeInTheDocument();
    });
  });
});