import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App';

// lucide-reactのアイコンがESMでインポートエラーになるのを防ぐためのモック
jest.mock('lucide-react', () => {
  return new Proxy({}, {
    get: function(target, prop) {
      return () => <span data-testid={`icon-${prop}`}>{prop}</span>;
    }
  });
});

describe('App', () => {
  beforeEach(() => {
    // window.alertをモック
    jest.spyOn(window, 'alert').mockImplementation(() => {});

    global.fetch = jest.fn((url) => {
      if (url === '/api/browse/') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            type: 'directory',
            items: [
              { name: 'image1.jpg', path: '/image1.jpg', isDirectory: false, isImage: true },
              { name: 'image2.jpg', path: '/image2.jpg', isDirectory: false, isImage: true },
              { name: 'doc.txt', path: '/doc.txt', isDirectory: false, isImage: false },
            ],
            popularTags: [],
            prevPath: null,
            nextPath: null
          }),
        });
      }
      if (url === '/api/browse/image1.jpg') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            type: 'file',
            name: 'image1.jpg',
            path: '/image1.jpg',
            isImage: true,
            prevPath: null,
            nextPath: '/image2.jpg'
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ type: 'directory', items: [], popularTags: [], prevPath: null, nextPath: null }),
      });
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders loading state initially', async () => {
    render(<App />);
    expect(screen.getByText(/フォルダを読み込み中/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText(/フォルダを読み込み中/i)).not.toBeInTheDocument();
    });
  });

  it('can start a slideshow for selected items', async () => {
    render(<App />);

    // ロード完了を待つ
    await waitFor(() => {
      expect(screen.getByText('image1.jpg')).toBeInTheDocument();
    });

    // image1.jpg を選択
    // checkbox はアイコンを含む div
    const checkIcons = screen.getAllByTestId('icon-Check');
    fireEvent.click(checkIcons[0]); // image1.jpgのチェックボックス

    // 一括操作バーが表示され、「スライドショー」ボタンがあることを確認
    const playButton = await screen.findByTitle('スライドショー');
    expect(playButton).toBeInTheDocument();

    // スライドショー開始
    fireEvent.click(playButton);

    // /image1.jpg に遷移し、ファイルの詳細画面（スライドショー再生中）になるのを待つ
    await waitFor(() => {
      // 遷移後のファイル名が表示される
      expect(screen.getByRole('heading', { name: 'image1.jpg' })).toBeInTheDocument();
    });

    // スライドショー再生中の表示 ("あと X秒") があることを確認
    expect(screen.getByText(/あと \d+秒/)).toBeInTheDocument();
  });
});

