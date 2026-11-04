import './globals.css'
import { themeInitialization } from '../lib/theme'

export const metadata = { title: 'Blok', description: 'A collaborative content workspace' }

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html:themeInitialization }} /></head><body>{children}</body></html>
}
