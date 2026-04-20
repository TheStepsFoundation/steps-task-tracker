'use client'

import { useState } from 'react'
import type { Intensity } from '@/lib/database.types'
import { INTENSITY_OPTIONS } from './types'

interface Subtask {
  id: number
  personId: number
  description: string
  intensity: Intensity
  completed?: boolean
}

interface QuickCompleteModalProps {
  taskTitle: string
  subtasks: Subtask[] // Only the current user's incomplete subtasks
  onConfirm: (completions: { subtaskId: number; actualHours: number; newIntensity: Intensity }[]) => void
  onCancel: () => void
}

const HOUR_OPTIONS = [
  { value: 0.33, label: '20m' },
  { value: 1, label: '1h' },
  { value: 2, label: '2h' },
  { value: 3, label: '3h' },
  { value: 4, label: '4h' },
  { value: 6, label: '6h' },
  { value: 8, label: '8h' },
]

function hoursToIntensity(hours: number): Intensity {
  if (hours <= 0.5) return 'quick'
  if (hours <= 1.5) return 'small'
  if (hours <= 4) return 'medium'
  if (hours <= 7) return 'large'
  return 'huge'
}

export function QuickCompleteModal({
  taskTitle,
  subtasks,
  onConfirm,
  onCancel,
}: QuickCompleteModalProps) {
  // Track which subtasks are selected and their hours
  const [selections, setSelections] = useState<Record<number, { selected: boolean; hours: number | null }>>(() => {
    const initial: Record<number, { selected: boolean; hours: number | null }> = {}
    subtasks.forEach(st => {
      initial[st.id] = { selected: true, hours: null }
    })
    return initial
  })

  const selectedCount = Object.values(selections).filter(s => s.selected).length
  const allHaveHours = Object.entries(selections)
    .filter(([_, s]) => s.selected)
    .every(([_, s]) => s.hours !== null)

  const handleConfirm = () => {
    const completions = Object.entries(selections)
      .filter(([_, s]) => s.selected && s.hours !== null)
      .map(([id, s]) => ({
        subtaskId: parseInt(id),
        actualHours: s.hours!,
        newIntensity: hoursToIntensity(s.hours!),
      }))
    onConfirm(completions)
  }

  const toggleAll = (selected: boolean) => {
    setSelections(prev => {
      const next = { ...prev }
      Object.keys(next).forEach(id => {
        next[parseInt(id)] = { ...next[parseInt(id)], selected }
      })
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Quick Complete</h2>
            <p className="text-sm text-gray-500 truncate max-w-[300px]">{taskTitle}</p>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Select all / none */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => toggleAll(true)}
              className="text-xs text-purple-600 hover:text-purple-700 font-medium"
            >
              Select all
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={() => toggleAll(false)}
              className="text-xs text-gray-500 hover:text-gray-700 font-medium"
            >
              Select none
            </button>
          </div>

          {/* Subtasks */}
          <div className="space-y-3">
            {subtasks.map(subtask => {
              const selection = selections[subtask.id]
              const predictedHours = INTENSITY_OPTIONS.find(o => o.value === subtask.intensity)?.hours || 1
              
              return (
                <div 
                  key={subtask.id}
                  className={`p-3 rounded-lg border-2 transition ${
                    selection.selected ? 'border-purple-200 bg-purple-50' : 'border-gray-100 bg-gray-50 opacity-60'
                  }`}
                >
                  {/* Checkbox + description */}
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selection.selected}
                      onChange={(e) => setSelections(prev => ({
                        ...prev,
                        [subtask.id]: { ...prev[subtask.id], selected: e.target.checked }
                      }))}
                      className="mt-1 w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {subtask.description || 'Untitled subtask'}
                      </p>
                      <p className="text-xs text-gray-500">
                        Predicted: ~{predictedHours}h ({subtask.intensity})
                      </p>
                    </div>
                  </label>

                  {/* Hours selection - only show if selected */}
                  {selection.selected && (
                    <div className="mt-3 ml-7">
                      <p className="text-xs text-gray-600 mb-2">How long did it take?</p>
                      <div className="flex flex-wrap gap-1.5">
                        {HOUR_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => setSelections(prev => ({
                              ...prev,
                              [subtask.id]: { ...prev[subtask.id], hours: opt.value }
                            }))}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                              selection.hours === opt.value
                                ? 'bg-purple-600 text-white'
                                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t bg-gray-50">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedCount === 0 || !allHaveHours}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Complete {selectedCount > 0 ? `(${selectedCount})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
