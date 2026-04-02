import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Megaphone, Plus } from 'lucide-react'

export default function CampaignsPage() {
  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground">Generate tracked links for email and SMS campaigns</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          New campaign
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>No campaigns yet</CardTitle>
          <CardDescription>
            Create a campaign to generate unique tracked links for each contact. When contacts click
            these links, they&apos;re immediately identified on your website.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <Megaphone className="w-10 h-10 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              Import your contacts first, then create a campaign to generate tracked links.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
