import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import type { SessionResponse } from "@/lib/session";

type NavbarProps = {
  session: SessionResponse;
  isSessionLoading: boolean;
};

export default function Navbar({ session, isSessionLoading }: NavbarProps) {
  const isAuthenticated = !isSessionLoading && session.authenticated;

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-black/5 bg-white/95 shadow-sm backdrop-blur">
      <nav className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-6 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <BrandLogo />
        </Link>

        <div className="flex items-center gap-3">
          {isSessionLoading ? null : !isAuthenticated ? (
            <>
              <Link
                href="/login"
                className="btn-3d btn-3d-white inline-flex h-11 w-28 items-center justify-center"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="btn-3d btn-3d-green inline-flex h-11 w-28 items-center justify-center"
              >
                Sign Up
              </Link>
            </>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
