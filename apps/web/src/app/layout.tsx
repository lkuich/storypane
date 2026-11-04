import './globals.css'

export const metadata = { title: 'Blok', description: 'A collaborative content workspace' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
