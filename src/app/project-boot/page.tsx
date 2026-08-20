"use client"

import { Suspense, useEffect } from "react"
import { useTranslations } from "next-intl"
import { AppTitleBar } from "@/components/layout/app-title-bar"
import { AppToaster } from "@/components/ui/app-toaster"
import { ProjectBootWorkspace } from "@/components/project-boot/project-boot-workspace"

function ProjectBootPageInner() {
  const t = useTranslations("ProjectBoot")

  useEffect(() => {
    document.title = `${t("title")} - MaxCode`
  }, [t])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <AppTitleBar
        center={
          <div className="text-sm font-semibold tracking-tight">
            {t("title")}
          </div>
        }
      />

      <main className="min-h-0 flex-1">
        <ProjectBootWorkspace />
      </main>

      <AppToaster position="bottom-right" duration={6000} closeButton />
    </div>
  )
}

export default function ProjectBootPage() {
  return (
    <Suspense>
      <ProjectBootPageInner />
    </Suspense>
  )
}
