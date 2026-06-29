import * as React from "react";
import { Glass, type GlassOptics } from "@samasante/liquid-glass";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const BUTTON_OPTICS: Partial<GlassOptics> = {
  strength: 0.25,
  depth: 1,
  curvature: 0.85,
  dispersion: 0.42,
  bend: 0.65,
  bendWidth: 0.14,
  frost: 0.35,
  brightness: 0.05,
  sheen: 0.22,
  sheenWidth: 12,
  glow: 0.05,
  glowSpread: 0.6,
  splay: 0.1,
  specular: 0.9,
};

const buttonVariants = cva(
  "liquid-glass-button relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold leading-none align-middle transition-[background,border-color,box-shadow,transform,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.985] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:self-center [&_svg]:align-middle",
  {
    variants: {
      variant: {
        default: "border border-white/6 bg-white/1 text-foreground shadow-[0_10px_26px_rgba(0,0,0,0.15)] hover:border-white/12 hover:bg-white/2",
        destructive: "border border-red-300/10 bg-red-500/4 text-red-300 shadow-[0_10px_28px_rgba(185,28,28,0.12)] hover:bg-red-500/8",
        outline: "border border-white/6 bg-white/0.5 text-foreground shadow-[0_8px_22px_rgba(0,0,0,0.1)] hover:border-white/12 hover:bg-white/1.5",
        secondary: "border border-white/6 bg-white/0.8 text-foreground/85 shadow-[0_8px_24px_rgba(0,0,0,0.1)] hover:bg-white/2 hover:text-foreground",
        ghost: "border border-transparent bg-transparent text-foreground/75 hover:border-white/6 hover:bg-white/1 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-12 px-8 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, children, ...props }, ref) => {
    const compClassName = cn(buttonVariants({ variant, size, className }));
    const glassLayer = (
      <Glass aria-hidden className="liquid-glass-button__optic" radius={999} optics={BUTTON_OPTICS}>
        <span className="block h-full w-full" />
      </Glass>
    );
    if (asChild && React.Children.count(children) === 1 && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ className?: string; ref?: React.Ref<unknown>; children?: React.ReactNode }>;
      return React.cloneElement(child, {
        ...props,
        className: cn(compClassName, child.props?.className),
        ref,
        children: (
          <>
            {glassLayer}
            <span className="liquid-glass-button__content">{child.props.children}</span>
          </>
        ),
      });
    }
    return (
      <button
        className={compClassName}
        ref={ref}
        {...props}
      >
        {glassLayer}
        <span className="liquid-glass-button__content">{children}</span>
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
