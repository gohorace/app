'use client'

import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function DataExportButtons() {
  function download(url: string) {
    window.location.href = url
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        onClick={() => download('/api/settings/data-export?format=json')}
      >
        <Download className="size-3.5" />
        Everything (JSON)
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => download('/api/settings/data-export?format=csv&resource=contacts')}
      >
        Contacts (CSV)
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => download('/api/settings/data-export?format=csv&resource=properties')}
      >
        Properties (CSV)
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => download('/api/settings/data-export?format=csv&resource=relationships')}
      >
        Relationships (CSV)
      </Button>
    </div>
  )
}
