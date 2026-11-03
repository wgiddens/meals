import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-stone-500">That page or recipe doesn&rsquo;t exist.</p>
      <Link href="/" className="btn btn-secondary mt-3">
        Back home
      </Link>
    </div>
  );
}
