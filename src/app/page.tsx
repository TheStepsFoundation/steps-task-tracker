'use client'

import { useState, DragEvent } from 'react'

// Team members from Steps Foundation
const TEAM_MEMBERS = [
  { id: 1, name: "God'sFavour Oluwanusin", role: 'Co-founder', avatar: 'GF' },
  { id: 2, name: 'Jin Samson', role: 'Co-founder', avatar: 'JS' },
  { id: 3, name: 'Daniyaal Anawar', role: 'Co-founder', avatar: 'DA' },
  { id: 4, name: 'Sam Ellis', role: 'Core Team', avatar: 'SE' },
  { id: 5, name: 'Earl Xavier', role: 'Core Team', avatar: 'EX' },
  { id: 6, name: 'Aditya Luthukumar', role: 'Core Team', avatar: 'AL' },
]

type Priority = 'low' | 'medium' | 'high' | 'urgent'
type Status = 'todo' | 'in-progress' | 'review' | 'done'

interface Task {
  id: number
  title: string
  description: string
  assignee: number
  priority: Priority
  status: Status
  dueDate: string
  createdAt: string
}

// Demo tasks
const INITIAL_TASKS: Task[] = [
  {
    id: 1,
    title: 'Finalise TikTok ad video',
    description: 'Edit and post the filmed TikTok ad for Event #4',
    assignee: 1,
    priority: 'high',
    status: 'in-progress',
    dueDate: '2026-03-16',
    createdAt: '2026-03-14',
  },
  {
    id: 2,
    title: 'Email blast to past attendees',
    description: 'Send event #4 invite to all previous event attendees',
    assignee: 2,
    priority: 'high',
    status: 'todo',
    dueDate: '2026-03-17',
    createdAt: '2026-03-14',
  },
  {
    id: 3,
    title: 'Confirm speakers for Lock-In',
    description: 'Follow up with all confirmed speakers and get final confirmations',
    assignee: 3,
    priority: 'urgent',
    status: 'in-progress',
    dueDate: '2026-03-15',
    createdAt: '2026-03-14',
  },
  {
    id: 4,
    title: 'Design event day schedule',
    description: 'Create detailed minute-by-minute schedule for March 21',
    assignee: 4,
    priority: 'medium',
    status: 'todo',
    dueDate: '2026-03-18',
    createdAt: '2026-03-14',
  },
  {
    id: 5,
    title: 'Book catering for event',
    description: 'Confirm lunch and refreshments for 250 attendees',
    assignee: 5,
    priority: 'high',
    status: 'review',
    dueDate: '2026-03-16',
    createdAt: '2026-03-14',
  },
  {
    id: 6,
    title: 'Print name badges',
    description: 'Design and print name badges for all confirmed attendees',
    assignee: 6,
    priority: 'low',
    status: 'todo',
    dueDate: '2026-03-20',
    createdAt: '2026-03-14',
  },
  {
    id: 7,
    title: 'Set up registration desk',
    description: 'Prepare check-in system and volunteer briefing',
    assignee: 1,
    priority: 'medium',
    status: 'done',
    dueDate: '2026-03-20',
    createdAt: '2026-03-10',
  },
]

const priorityColors: Record<Priority, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

const statusColors: Record<Status, string> = {
  'todo': 'bg-gray-200',
  'in-progress': 'bg-yellow-200',
  'review': 'bg-purple-200',
  'done': 'bg-green-200',
}

const statusLabels: Record<Status, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'review': 'Review',
  'done': 'Done',
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS)
  const [view, setView] = useState<'board' | 'team' | 'list' | 'workload'>('board')
  const [draggedTask, setDraggedTask] = useState<number | null>(null)

  const getTasksByStatus = (status: Status) => tasks.filter(t => t.status === status)
  const getTasksByMember = (memberId: number, includeArchived: boolean = false) => {
    if (includeArchived) {
      return tasks.filter(t => t.assignee === memberId)
    }
    return tasks.filter(t => t.assignee === memberId && t.status !== 'done')
  }
  const getArchivedTasksByMember = (memberId: number) => 
    tasks.filter(t => t.assignee === memberId && t.status === 'done')
  
  const getMember = (id: number) => TEAM_MEMBERS.find(m => m.id === id)
  
  const getWorkload = (memberId: number) => {
    const memberTasks = tasks.filter(t => t.assignee === memberId && t.status !== 'done')
    return {
      total: memberTasks.length,
      urgent: memberTasks.filter(t => t.priority === 'urgent').length,
      high: memberTasks.filter(t => t.priority === 'high').length,
    }
  }

  // Drag and drop handlers
  const handleDragStart = (e: DragEvent, taskId: number) => {
    setDraggedTask(taskId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDropOnStatus = (e: DragEvent, newStatus: Status) => {
    e.preventDefault()
    if (draggedTask === null) return
    
    setTasks(prev => prev.map(task => 
      task.id === draggedTask ? { ...task, status: newStatus } : task
    ))
    setDraggedTask(null)
  }

  const handleDropOnMember = (e: DragEvent, newAssignee: number) => {
    e.preventDefault()
    if (draggedTask === null) return
    
    setTasks(prev => prev.map(task => 
      task.id === draggedTask ? { ...task, assignee: newAssignee } : task
    ))
    setDraggedTask(null)
  }

  const handleDragEnd = () => {
    setDraggedTask(null)
  }

  // Task card component
  const TaskCard = ({ task, showStatus = false }: { task: Task; showStatus?: boolean }) => {
    const member = getMember(task.assignee)
    return (
      <div
        draggable
        onDragStart={(e) => handleDragStart(e, task.id)}
        onDragEnd={handleDragEnd}
        className={`bg-white rounded-lg p-4 shadow-sm border border-gray-100 hover:shadow-md transition cursor-grab active:cursor-grabbing ${
          draggedTask === task.id ? 'opacity-50' : ''
        }`}
      >
        <h3 className="font-medium text-gray-900 mb-2">{task.title}</h3>
        <p className="text-sm text-gray-500 mb-3 line-clamp-2">
          {task.description}
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full ${priorityColors[task.priority]}`}>
              {task.priority}
            </span>
            {showStatus && (
              <span className={`text-xs px-2 py-1 rounded-full ${statusColors[task.status]} text-gray-700`}>
                {statusLabels[task.status]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">
              {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
            {member && (
              <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-xs font-medium" title={member.name}>
                {member.avatar.charAt(0)}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Steps Task Tracker</h1>
          <p className="text-gray-500">Event #4: The Great Lock-In — March 21, 2026</p>
        </div>
        <div className="flex gap-2">
          {(['board', 'team', 'list', 'workload'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2 rounded-lg font-medium transition capitalize ${
                view === v ? 'bg-purple-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Team View - Columns by team member */}
      {view === 'team' && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {TEAM_MEMBERS.map(member => {
            const activeTasks = getTasksByMember(member.id)
            const archivedTasks = getArchivedTasksByMember(member.id)
            
            return (
              <div 
                key={member.id} 
                className="bg-gray-50 rounded-xl p-4 min-h-[400px]"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropOnMember(e, member.id)}
              >
                {/* Member header */}
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-200">
                  <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-sm">
                    {member.avatar}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-gray-700 text-sm truncate">{member.name.split(' ')[0]}</h2>
                    <p className="text-xs text-gray-400">{activeTasks.length} active</p>
                  </div>
                </div>
                
                {/* Active tasks */}
                <div className="space-y-3 mb-4">
                  {activeTasks.map(task => (
                    <TaskCard key={task.id} task={task} showStatus />
                  ))}
                  {activeTasks.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">No active tasks</p>
                  )}
                </div>

                {/* Archived/Done tasks */}
                {archivedTasks.length > 0 && (
                  <div className="border-t border-gray-200 pt-3">
                    <p className="text-xs text-gray-400 mb-2">Completed ({archivedTasks.length})</p>
                    <div className="space-y-2 opacity-60">
                      {archivedTasks.slice(0, 3).map(task => (
                        <div key={task.id} className="bg-white rounded-lg p-3 text-sm">
                          <p className="text-gray-600 line-clamp-1">{task.title}</p>
                        </div>
                      ))}
                      {archivedTasks.length > 3 && (
                        <p className="text-xs text-gray-400 text-center">
                          +{archivedTasks.length - 3} more
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Workload View */}
      {view === 'workload' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {TEAM_MEMBERS.map(member => {
            const workload = getWorkload(member.id)
            const maxTasks = 5
            const loadPercent = Math.min((workload.total / maxTasks) * 100, 100)
            
            return (
              <div key={member.id} className="bg-white rounded-xl p-5 shadow-sm border">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold">
                    {member.avatar}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{member.name}</h3>
                    <p className="text-sm text-gray-500">{member.role}</p>
                  </div>
                </div>
                
                <div className="mb-3">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Workload</span>
                    <span className="font-medium">{workload.total} tasks</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all ${
                        loadPercent > 80 ? 'bg-red-500' : loadPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${loadPercent}%` }}
                    />
                  </div>
                </div>
                
                <div className="flex gap-2 text-xs">
                  {workload.urgent > 0 && (
                    <span className="px-2 py-1 bg-red-100 text-red-700 rounded">
                      {workload.urgent} urgent
                    </span>
                  )}
                  {workload.high > 0 && (
                    <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded">
                      {workload.high} high
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Board View - Kanban with drag & drop */}
      {view === 'board' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {(['todo', 'in-progress', 'review', 'done'] as Status[]).map(status => (
            <div 
              key={status} 
              className={`bg-gray-50 rounded-xl p-4 min-h-[400px] transition ${
                draggedTask !== null ? 'ring-2 ring-purple-200 ring-inset' : ''
              }`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnStatus(e, status)}
            >
              <div className="flex items-center gap-2 mb-4">
                <div className={`w-3 h-3 rounded-full ${statusColors[status]}`} />
                <h2 className="font-semibold text-gray-700">
                  {statusLabels[status]}
                </h2>
                <span className="ml-auto text-sm text-gray-400">
                  {getTasksByStatus(status).length}
                </span>
              </div>
              
              <div className="space-y-3">
                {getTasksByStatus(status).map(task => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-4 font-medium text-gray-600">Task</th>
                <th className="text-left p-4 font-medium text-gray-600">Assignee</th>
                <th className="text-left p-4 font-medium text-gray-600">Priority</th>
                <th className="text-left p-4 font-medium text-gray-600">Status</th>
                <th className="text-left p-4 font-medium text-gray-600">Due</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => {
                const member = getMember(task.assignee)
                return (
                  <tr key={task.id} className="border-b hover:bg-gray-50">
                    <td className="p-4">
                      <div className="font-medium text-gray-900">{task.title}</div>
                      <div className="text-sm text-gray-500">{task.description}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {member && (
                          <>
                            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-sm font-medium">
                              {member.avatar}
                            </div>
                            <span className="text-gray-700">{member.name.split(' ')[0]}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`text-xs px-2 py-1 rounded-full ${priorityColors[task.priority]}`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`text-xs px-2 py-1 rounded-full ${statusColors[task.status]} text-gray-700`}>
                        {statusLabels[task.status]}
                      </span>
                    </td>
                    <td className="p-4 text-gray-600">
                      {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Drag hint */}
      {draggedTask !== null && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-full text-sm shadow-lg">
          Drop to move task
        </div>
      )}
    </main>
  )
}
