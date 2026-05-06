self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Horace', body: event.data.text(), url: '/dashboard' }
  }

  const { title = 'Horace', body = '', url = '/dashboard', tag } = payload

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/horace-notif-icon.png',
      badge: '/icon-192.png',
      tag: tag ?? 'horace-alert',
      renotify: true,
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/dashboard'

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url)
            return client.focus()
          }
        }
        return clients.openWindow(url)
      })
  )
})
