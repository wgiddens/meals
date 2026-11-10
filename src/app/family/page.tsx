import { headers } from "next/headers";
import { Suspense } from "react";
import {
  CancelInvitationButton,
  InviteForm,
  RemoveMemberButton,
  RenameFamily,
} from "@/components/FamilyControls";
import { listFamily, type FamilyMember } from "@/lib/family";
import { currentMember } from "@/lib/member";

export const metadata = { title: "Family" };

/**
 * Who is in the family and who has been invited. Every member sees it; only
 * the owner gets the controls, and each control's Server Action checks
 * requireOwner() again (src/app/family/actions.ts).
 */
export default function FamilyPage() {
  return (
    <Suspense fallback={<p className="text-stone-500">Loading family…</p>}>
      <Family />
    </Suspense>
  );
}

/**
 * The address to give an invited person: BETTER_AUTH_URL when set, otherwise
 * the origin this request came in on.
 */
async function appAddress(): Promise<string> {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host") || "localhost:3000";
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  return `${forwardedProto || (local ? "http" : "https")}://${host}`;
}

const roleLabel = { owner: "Owner", member: "Member" } as const;

async function Family() {
  // The member first: it reads the request, so nothing below is prerendered.
  const me = await currentMember();
  const family = await listFamily();
  const isOwner = me?.role === "owner";
  const appUrl = isOwner ? await appAddress() : null;
  const owner = family.members.find((m) => m.role === "owner");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        {isOwner ? (
          <RenameFamily name={family.name} />
        ) : (
          <h1 className="text-2xl font-semibold break-words">{family.name}</h1>
        )}
        {!isOwner && owner ? (
          <p className="text-sm text-stone-500">{owner.name} manages who is in the family.</p>
        ) : null}
      </div>

      <section className="space-y-2" aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-lg font-semibold">
          Members
        </h2>
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white shadow-xs">
          {family.members.map((m) => (
            <MemberRow key={m.id} member={m} isMe={m.id === me?.id} canRemove={isOwner && m.role !== "owner"} />
          ))}
        </ul>
      </section>

      <section className="space-y-2" aria-labelledby="invitations-heading">
        <h2 id="invitations-heading" className="text-lg font-semibold">
          Invitations
        </h2>
        {family.invitations.length === 0 ? (
          <p className="text-sm text-stone-500">No pending invitations.</p>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white shadow-xs">
            {family.invitations.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="font-medium break-words">{inv.name}</div>
                  <div className="text-sm text-stone-500 break-all">{inv.email}</div>
                  <div className="text-xs text-stone-400">Waiting for them to sign in</div>
                </div>
                {isOwner ? <CancelInvitationButton invitationId={inv.id} name={inv.name} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner && appUrl ? (
        <section className="card space-y-3" aria-labelledby="invite-heading">
          <div>
            <h2 id="invite-heading" className="text-lg font-semibold">
              Invite someone
            </h2>
            <p className="text-sm text-stone-500">
              They sign in with the Google account for this email. No email is sent; you pass on the
              app&rsquo;s address.
            </p>
          </div>
          <InviteForm appUrl={appUrl} />
        </section>
      ) : null}
    </div>
  );
}

function MemberRow({ member, isMe, canRemove }: { member: FamilyMember; isMe: boolean; canRemove: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-words">{member.name}</span>
          {isMe ? <span className="chip">You</span> : null}
        </div>
        <div className="text-sm text-stone-500 break-all">{member.email}</div>
        <div className="text-xs text-stone-500">{roleLabel[member.role]}</div>
      </div>
      {canRemove ? <RemoveMemberButton memberId={member.id} name={member.name} /> : null}
    </li>
  );
}
