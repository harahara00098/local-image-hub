import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

// lucide-reactのアイコンがESMでインポートエラーになるのを防ぐためのモック
jest.mock('lucide-react', () => {
  return new Proxy({}, {
    get: function(target, prop) {
      return () => <span>{prop}</span>;
    }
  });
});

describe('App', () => {
  beforeAll(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ type: 'directory', items: [], popularTags: [], prevPath: null, nextPath: null }),
      })
    ) as jest.Mock;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('renders loading state initially', async () => {
    render(<App />);
    expect(screen.getByText(/フォルダを読み込み中/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/このフォルダは空です/i)).toBeInTheDocument();
    });
  });
});
