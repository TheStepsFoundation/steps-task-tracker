'use client'

import { MouseEvent, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Task, Workflow, TeamMember, Status, statusColors, statusLabels, priorityColors, getDueDateStatus, dueDateColors } from './types'

interface DraggableTaskCardProps {
  task: Task
  onClick: () => void
  showStatus?: boolean
  workflows: Workflow[]
  teamMembers: TeamMember[]
  viewingMemberId?: number
  onToggleComplete?: (task: Task, memberId: number) => void
  onMoveToStatus?: (task: Task, status: Status) => void
}

export function DraggableTaskCard({ 
  task, 
  onClick,
  showStatus = false,
  workflows,
  teamMembers,
  viewingMemberId,
  onToggleComplete,
  onMoveToStatus,
}: DraggableTaskCardProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  })

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 1000,
  } : undefined

  const member = task.assignee ? teamMembers.find(m => m.id === task.assignee) : null
  const workflow = workflows.find(w => w.id === task.workflow)
  const subWorkflow = workflows.find(w => w.id === task.subWorkflow)
  
  const isPrimaryAssignee = viewingMemberId !== undefined && task.assignee === viewingMemberId
  
  const memberSubtasks = viewingMemberId !== undefined 
    ? task.subtasks.filter(st => st.personId === viewingMemberId)
    : []
  const hasSubtasks = memberSubtasks.length > 0
  const allSubtasksCompleted = hasSubtasks && memberSubtasks.every(st => st.completed)

  // Due date indicator
  const dueDateStatus = getDueDateStatus(task.dueDate)
  const dueDateBadgeClass = dueDateColors[dueDateStatus]

  const handleCardClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.drag-handle') || 
        (e.target as HTMLElement).closest('.move-menu')) {
      return
    }
    onClick()
  }

  const handleMoveClick = (e: MouseEvent) => {
    e.stopPropagation()
    setShowMoveMenu(!showMoveMenu)
  }

  const handleMoveToStatus = (status: Status) => {
    setShowMoveMenu(false)
    onMoveToStatus?.(task, status)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleCardClick}
      className={`group relative bg-white rounded-lg p-4 shadow-sm border hover:shadow-md transition-all duration-200 ease-out cursor-pointer ${
        isDragging ? 'opacity-60 shadow-lg scale-[1.02]' : ''
      } ${
        isPrimaryAssignee ? 'border-purple-300 ring-2 ring-purple-200' : 'border-gray-100'
      } ${
        allSubtasksCompleted ? 'opacity-60' : ''
      }`}
    >
      {/* Drag Handle - hidden on mobile, shown on desktop */}
      <div 
        {...listeners}
        {...attributes}
        className="drag-handle absolute top-2 right-2 p-1.5 rounded hover:bg-gray-100 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none transition-colors hidden sm:block"
        onClick={(e) => e.stopPropagation()}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
        </svg>
      </div>

      {/* Mobile Move Button - shown only on mobile */}
      {onMoveToStatus && (
        <div className="move-menu absolute top-2 right-2 sm:hidden">
          <button
            onClick={handleMoveClick}
            className="p-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
          </button>
          
          {showMoveMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[120px]">
              {(['todo', 'in-progress', 'review', 'done'] as Status[]).map(status => (
                <button
                  key={status}
                  onClick={() => handleMoveToStatus(status)}
                  disabled={task.status === status}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 transition ${
                    task.status === status ? 'text-gray-400 bg-gray-50' : 'text-gray-700'
                  }`}
                >
                  {statusLabels[status]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Completion Checkbox - only in Team view */}
      {viewingMemberId !== undefined && onToggleComplete && hasSubtasks && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleComplete(task, viewingMemberId)
          }}
          className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition ${
            allSubtasksCompleted
              ? 'bg-green-500 border-green-500 text-white'
              : 'border-gray-300 hover:border-green-400 bg-white opacity-0 group-hover:opacity-100'
          }`}
        >
          {allSubtasksCompleted && (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      )}

      {/* Workflow badges */}
      {workflow && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded text-white whitespace-nowrap ${workflow.color}`}>
            {workflow.short}
          </span>
          {subWorkflow && (
            <>
              <span className="text-gray-400 text-xs">›</span>
              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded text-white whitespace-nowrap ${subWorkflow.color}`}>
                {subWorkflow.short}
              </span>
            </>
          )}
        </div>
      )}

      <h3 className="font-medium text-gray-900 mb-2 pr-8">{task.title}</h3>
      <p className="text-sm text-gray-500 mb-3 line-clamp-2">{task.description}</p>
      
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${priorityColors[task.priority]}`}>
          {task.priority}
        </span>
        {showStatus && (
          <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${statusColors[task.status]}`}>
            {statusLabels[task.status]}
          </span>
        )}
        {/* Due date with indicator */}
        <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${dueDateBadgeClass || 'text-gray-400'}`}>
          {dueDateStatus === 'overdue' && '⚠️ '}
          {dueDateStatus === 'today' && '📅 '}
          {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </span>
        <div className="flex -space-x-2 ml-auto">
          {member ? (
            <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-[10px] font-medium border-2 border-white" title={member.name}>
              {member.avatar}
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-[10px] border-2 border-white" title="Unassigned">
              ?
            </div>
          )}
          {task.collaborators.slice(0, 2).map(collabId => {
            const collab = teamMembers.find(m => m.id === collabId)
            return collab ? (
              <div key={collabId} className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-[10px] font-medium border-2 border-white" title={collab.name}>
                {collab.avatar}
              </div>
            ) : null
          })}
          {task.collaborators.length > 2 && (
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-[10px] font-medium border-2 border-white">
              +{task.collaborators.length - 2}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
