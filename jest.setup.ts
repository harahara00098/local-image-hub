import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

// Mock window.scrollTo to prevent jsdom "Not implemented" errors
Object.defineProperty(window, 'scrollTo', {
  value: () => {},
  writable: true
});
