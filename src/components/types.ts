// Shared types for components
import type { Task, Workflow, TeamMember, Intensity, Status, Priority } from '@/lib/database.types'

export type { Task, Workflow, TeamMember, Intensity, Status, Priority }

export const INTENSITY_OPTIONS: { value: Intensity; label: string; hours: number }[] = [
  { value: 'quick', label: 'Quick Win (~20 min)', hours: 0.33 },
  { value: 'small', label: 'Small (~1 hr)', hours: 1 },
  { value: 'medium', label: 'Medium (~3 hrs)', hours: 3 },
  { value: 'large', label: 'Large (~6 hrs)', hours: 6 },
  { value: 'huge', label: 'Huge (~1 day)', hours: 8 },
]

export const priorityColors: Record<Priority, string> = {
  low: 'bg-gray-100 text-gray-700 border-gray-200',
  medium: 'bg-blue-100 text-blue-700 border-blue-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  urgent: 'bg-red-100 text-red-700 border-red-200',
}

export const statusColors: Record<Status, string> = {
  'todo': 'bg-gray-200 text-gray-700',
  'in-progress': 'bg-yellow-200 text-yellow-800',
  'review': 'bg-steps-blue-200 text-steps-blue-700',
  'done': 'bg-green-200 text-green-700',
}

export const statusLabels: Record<Status, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'review': 'Review',
  'done': 'Done',
}

export const intensityColors: Record<Intensity, string> = {
  quick: 'bg-green-100 text-green-700',
  small: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  large: 'bg-orange-100 text-orange-700',
  huge: 'bg-red-100 text-red-700',
}

export const WORKFLOW_COLORS = [
  'bg-steps-blue-500', 'bg-blue-500', 'bg-steps-blue-500', 'bg-violet-500',
  'bg-green-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500',
  'bg-pink-500', 'bg-teal-500', 'bg-orange-500', 'bg-emerald-500',
]

// Date helper functions
export function getDueDateStatus(dueDate: string): 'overdue' | 'today' | 'this-week' | 'future' {
  const due = new Date(dueDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  
  const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  
  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  if (diffDays <= 7) return 'this-week'
  return 'future'
}

export const dueDateColors: Record<ReturnType<typeof getDueDateStatus>, string> = {
  'overdue': 'bg-red-500 text-white',
  'today': 'bg-orange-500 text-white',
  'this-week': 'bg-yellow-400 text-yellow-900',
  'future': '',
}
