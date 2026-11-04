import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";
import { isSignedIn, safeReturnPath } from "@/lib/household";

export const metadata = { title: "Sign in" };

export default function LoginPage(props: { searchParams: Promise<{ next?: string }> }) {
  return (
    <Suspense fallback={null}>
      <Gate searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Gate({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeReturnPath((await searchParams).next);
  // Already in (or no passcode configured): nothing to do here.
  if (await isSignedIn()) redirect(next);
  return <LoginForm next={next} />;
}
