import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

// Loaded as a plain stylesheet link (not next/font/google) so production
// builds don't need outbound network access to fonts.googleapis.com at
// build time — the browser fetches it at runtime instead, same as the
// design mockups this app was built from.
export const metadata: Metadata = {
  title: "Taskflow",
  description: "Smart Task Management System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- this is the App Router root layout (applies globally), not a Pages Router page */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
