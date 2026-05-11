export const metadata = {
  title: 'Shape de Elite API',
  description: 'Backend do app Shape de Elite'
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
