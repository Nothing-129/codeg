import { Suspense } from "react"
import { SettingsShell } from "@/components/settings/settings-shell"
import { RemoteConnectionGate } from "@/contexts/remote-connection-context"

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense>
      <RemoteConnectionGate>
        <SettingsShell>{children}</SettingsShell>
      </RemoteConnectionGate>
    </Suspense>
  )
}
