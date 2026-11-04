import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/styles/site.css';

export const metadata: Metadata = {
  title: { default: 'Fieldwork', template: '%s · Fieldwork' },
  description: 'Fieldwork — a small studio for big ideas. A Next.js site powered by Storypane.',
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23232e27'/%3E%3Ctext x='14' y='48' fill='%23e6ee9c' font-size='44' font-family='Georgia'%3Ef%3C/text%3E%3C/svg%3E",
  },
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
