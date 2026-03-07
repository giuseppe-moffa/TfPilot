"use client"

export type MemberWithAvatar = {
  login: string
  avatarUrl?: string | null
}

const MAX_VISIBLE = 3

function avatarUrlFor(login: string, avatarUrl?: string | null): string {
  if (avatarUrl) return avatarUrl
  return `https://github.com/${encodeURIComponent(login)}.png`
}

export function TeamMembersAvatars({ members }: { members: MemberWithAvatar[] }) {
  if (members.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>
  }
  const visible = members.slice(0, MAX_VISIBLE)
  const overflow = members.length - MAX_VISIBLE
  return (
    <div className="flex items-center -space-x-2">
      {visible.map((m) => (
        <img
          key={m.login}
          src={avatarUrlFor(m.login, m.avatarUrl)}
          alt=""
          className="h-8 w-8 rounded-full border-2 border-background object-cover"
          width={32}
          height={32}
          title={m.login}
        />
      ))}
      {overflow > 0 && (
        <span
          className="flex h-8 min-w-8 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium text-muted-foreground"
          title={members.slice(MAX_VISIBLE).map((m) => m.login).join(", ")}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}
