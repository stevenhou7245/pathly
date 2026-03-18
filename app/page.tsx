"use client";

import Hero from "@/components/Hero";
import Navbar from "@/components/Navbar";
import type { SessionResponse } from "@/lib/session";
import { useEffect, useState } from "react";

const DEFAULT_SESSION: SessionResponse = {
  authenticated: false,
  user: null,
};

export default function Home() {
  const [session, setSession] = useState<SessionResponse>(DEFAULT_SESSION);
  const [isSessionLoading, setIsSessionLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Failed to fetch session");
        }

        const payload: SessionResponse = await response.json();
        if (isMounted) {
          setSession(payload);
        }
      } catch {
        if (isMounted) {
          setSession(DEFAULT_SESSION);
        }
      } finally {
        if (isMounted) {
          setIsSessionLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <Navbar session={session} isSessionLoading={isSessionLoading} />
      <main className="pt-20">
        <Hero session={session} isSessionLoading={isSessionLoading} />
      </main>
    </div>
  );
}
