import './globals.css';
import { themeInitialization } from '../lib/theme';

export const metadata = {
  title: 'Storypane',
  description: 'A collaborative content workspace',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
      { url: '/favicon-48.png', type: 'image/png', sizes: '48x48' },
    ],
    apple: { url: '/apple-touch-icon.png', sizes: '180x180' },
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitialization }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
