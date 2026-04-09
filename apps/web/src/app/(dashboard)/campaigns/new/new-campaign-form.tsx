'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Search, Loader2 } from 'lucide-react'

type Contact = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
}

export function NewCampaignForm({ contacts }: { contacts: Contact[] }) {
  const router = useRouter()

  // Step 1 fields
  const [name, setName] = useState('')
  const [targetUrl, setTargetUrl] = useState('')

  // Step 2 — contact selection
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter((c) => {
      const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ').toLowerCase()
      return fullName.includes(q) || (c.email ?? '').toLowerCase().includes(q)
    })
  }, [contacts, search])

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id))

  function toggleContact(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      // Deselect all filtered
      setSelected((prev) => {
        const next = new Set(prev)
        filtered.forEach((c) => next.delete(c.id))
        return next
      })
    } else {
      // Select all filtered
      setSelected((prev) => {
        const next = new Set(prev)
        filtered.forEach((c) => next.add(c.id))
        return next
      })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) { setError('Campaign name is required.'); return }
    if (!targetUrl.trim()) { setError('Target URL is required.'); return }
    if (selected.size === 0) { setError('Select at least one contact.'); return }

    setIsSubmitting(true)
    try {
      // 1. Create campaign
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), target_url: targetUrl.trim() }),
      })
      if (!createRes.ok) {
        const body = await createRes.json()
        throw new Error(body.error ?? 'Failed to create campaign')
      }
      const campaign = await createRes.json()

      // 2. Generate tokens
      const tokenRes = await fetch(`/api/campaigns/${campaign.id}/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_ids: Array.from(selected),
          target_url: targetUrl.trim(),
        }),
      })
      if (!tokenRes.ok) {
        const body = await tokenRes.json()
        throw new Error(body.error ?? 'Failed to generate tokens')
      }

      router.push(`/campaigns/${campaign.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Step 1: Campaign details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campaign details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Campaign name *</Label>
            <Input
              id="name"
              placeholder="e.g. Spring 2026 open homes"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="target_url">Target URL *</Label>
            <Input
              id="target_url"
              type="url"
              placeholder="https://yourwebsite.com/listings"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              The URL contacts will visit. Each contact gets a unique tracked version of this link.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Contact selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Select contacts
            {selected.size > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({selected.size} selected)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No contacts found. Import your CRM first.
            </p>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email…"
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="border rounded-md overflow-hidden">
                {/* Select all row */}
                <label className="flex items-center gap-3 px-4 py-2.5 bg-muted/40 border-b cursor-pointer hover:bg-muted/60 transition-colors select-none">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                  <span className="text-sm font-medium">
                    {allFilteredSelected ? 'Deselect all' : 'Select all'}
                    {search && filtered.length !== contacts.length && (
                      <span className="text-muted-foreground font-normal ml-1">
                        ({filtered.length} matching)
                      </span>
                    )}
                  </span>
                </label>

                {/* Contact list */}
                <div className="max-h-80 overflow-y-auto divide-y">
                  {filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-4 py-6 text-center">
                      No contacts match &ldquo;{search}&rdquo;
                    </p>
                  ) : (
                    filtered.map((c) => {
                      const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'
                      const isChecked = selected.has(c.id)
                      return (
                        <label
                          key={c.id}
                          className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors select-none ${
                            isChecked ? 'bg-primary/5' : 'hover:bg-muted/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleContact(c.id)}
                            className="h-4 w-4 rounded border-input accent-primary shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{name}</p>
                            {c.email && (
                              <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                            )}
                          </div>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-md">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isSubmitting ? 'Creating campaign…' : 'Create campaign & generate links'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
