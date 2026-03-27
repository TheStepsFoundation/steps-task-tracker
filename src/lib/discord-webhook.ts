// Discord Webhook Integration

interface DiscordEmbed {
  title: string
  description?: string
  color?: number
  fields?: { name: string; value: string; inline?: boolean }[]
  url?: string
  timestamp?: string
}

interface DiscordMessage {
  content?: string
  embeds?: DiscordEmbed[]
}

// Get webhook URL from environment or localStorage
export function getDiscordWebhookUrl(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('discord-webhook-url')
  }
  return process.env.NEXT_PUBLIC_DISCORD_WEBHOOK_URL || null
}

export function setDiscordWebhookUrl(url: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('discord-webhook-url', url)
  }
}

// Send notification to Discord
export async function sendDiscordNotification(message: DiscordMessage): Promise<boolean> {
  const webhookUrl = getDiscordWebhookUrl()
  if (!webhookUrl) return false

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })
    return response.ok
  } catch (error) {
    console.error('Discord webhook error:', error)
    return false
  }
}

// Notification helpers
export async function notifyTaskAssigned(task: {
  title: string
  assignee: string
  dueDate: string
  priority: string
}, appUrl?: string) {
  const priorityColors: Record<string, number> = {
    low: 0x808080,
    medium: 0x3498db,
    high: 0xf39c12,
    urgent: 0xe74c3c,
  }

  return sendDiscordNotification({
    embeds: [{
      title: '📋 Task Assigned',
      description: task.title,
      color: priorityColors[task.priority] || 0x9b59b6,
      fields: [
        { name: 'Assigned To', value: task.assignee, inline: true },
        { name: 'Priority', value: task.priority.toUpperCase(), inline: true },
        { name: 'Due Date', value: new Date(task.dueDate).toLocaleDateString('en-GB', { 
          day: 'numeric', month: 'short', year: 'numeric' 
        }), inline: true },
      ],
      url: appUrl,
      timestamp: new Date().toISOString(),
    }],
  })
}

export async function notifyTaskDueSoon(task: {
  title: string
  assignee: string
  dueDate: string
  daysUntilDue: number
}, appUrl?: string) {
  const isOverdue = task.daysUntilDue < 0
  const emoji = isOverdue ? '🚨' : task.daysUntilDue === 0 ? '⏰' : '📅'
  const title = isOverdue 
    ? `${emoji} Task Overdue!` 
    : task.daysUntilDue === 0 
      ? `${emoji} Task Due Today!` 
      : `${emoji} Task Due Tomorrow`

  return sendDiscordNotification({
    embeds: [{
      title,
      description: task.title,
      color: isOverdue ? 0xe74c3c : task.daysUntilDue === 0 ? 0xf39c12 : 0x3498db,
      fields: [
        { name: 'Assigned To', value: task.assignee, inline: true },
        { name: 'Due Date', value: new Date(task.dueDate).toLocaleDateString('en-GB', { 
          day: 'numeric', month: 'short', year: 'numeric' 
        }), inline: true },
      ],
      url: appUrl,
      timestamp: new Date().toISOString(),
    }],
  })
}

export async function notifyTaskCompleted(task: {
  title: string
  completedBy: string
}, appUrl?: string) {
  return sendDiscordNotification({
    embeds: [{
      title: '✅ Task Completed',
      description: task.title,
      color: 0x2ecc71,
      fields: [
        { name: 'Completed By', value: task.completedBy, inline: true },
      ],
      url: appUrl,
      timestamp: new Date().toISOString(),
    }],
  })
}
