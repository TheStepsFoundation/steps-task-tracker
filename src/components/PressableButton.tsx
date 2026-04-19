'use client'

import * as React from 'react'
import Link from 'next/link'

type Variant = 'primary' | 'secondary' | 'white' | 'outline'
type Size = 'sm' | 'md' | 'lg'

interface BaseProps {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
  children: React.ReactNode
  className?: string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

type ButtonProps = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & {
    href?: undefined
  }

type LinkProps = BaseProps & {
  href: string
  target?: string
  rel?: string
}

type PressableButtonProps = ButtonProps | LinkProps

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-steps-blue text-white border-t border-white/20 shadow-press-blue hover:shadow-press-blue-hover hover:-translate-y-1 active:translate-y-1 active:shadow-none active:scale-[0.98]',
  secondary:
    'bg-steps-dark text-white border-t border-white/20 shadow-press-dark hover:shadow-press-dark-hover hover:-translate-y-1 active:translate-y-1 active:shadow-none active:scale-[0.98]',
  white:
    'bg-white text-slate-900 border border-slate-100 shadow-press-white hover:shadow-press-white-hover hover:-translate-y-1 active:translate-y-1 active:shadow-none active:scale-[0.98]',
  outline:
    'bg-transparent text-white border-2 border-white/30 hover:bg-white/10 hover:border-white/50 backdrop-blur-sm',
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-2.5 text-base',
  lg: 'px-7 py-3.5 text-lg',
}

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold tracking-tight ' +
  'transition-all duration-150 ease-out select-none ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-steps-blue focus-visible:ring-offset-2 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none'

function mergeClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ')
}

export const PressableButton = React.forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  PressableButtonProps
>(function PressableButton(props, ref) {
  const {
    variant = 'primary',
    size = 'md',
    fullWidth,
    children,
    className,
    leftIcon,
    rightIcon,
    ...rest
  } = props

  const classes = mergeClasses(
    BASE,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth && 'w-full',
    className
  )

  const content = (
    <>
      {leftIcon ? <span className="inline-flex shrink-0">{leftIcon}</span> : null}
      <span>{children}</span>
      {rightIcon ? <span className="inline-flex shrink-0">{rightIcon}</span> : null}
    </>
  )

  if ('href' in rest && rest.href) {
    const { href, target, rel, ...anchorRest } = rest as LinkProps & Record<string, unknown>
    return (
      <Link
        href={href}
        target={target}
        rel={rel}
        ref={ref as React.Ref<HTMLAnchorElement>}
        className={classes}
        {...(anchorRest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {content}
      </Link>
    )
  }

  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      className={classes}
      {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {content}
    </button>
  )
})

export default PressableButton
