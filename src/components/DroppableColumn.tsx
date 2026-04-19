'use client'

import { useDroppable } from '@dnd-kit/core'
import { ReactNode } from 'react'

interface DroppableColumnProps {
  id: string
  children: ReactNode
  className?: string
}

export function DroppableColumn({ id, children, className = '' }: DroppableColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id })
  
  return (
    <div 
      ref={setNodeRef}
      className={`${className} transition-all duration-150 ease-out ${
        isOver ? 'ring-2 ring-steps-blue-400 ring-inset bg-steps-blue-50/70 scale-[1.01]' : ''
      }`}
    >
      {children}
    </div>
  )
}
