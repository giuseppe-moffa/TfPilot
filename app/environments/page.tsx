"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function EnvironmentsPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-xl text-center">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold">
            Environments
          </CardTitle>
          <CardDescription>
            Environment management coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          We&apos;re building the Environments experience. Check back shortly.
        </CardContent>
      </Card>
    </div>
  )
}