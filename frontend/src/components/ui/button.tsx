import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "liquid-glass-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold leading-none align-middle transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:self-center [&_svg]:align-middle",
  {
    variants: {
      variant: {
        default: "border border-white/20 bg-white/16 text-foreground shadow-[0_12px_34px_rgba(0,0,0,0.22)] hover:border-white/35 hover:bg-white/24 hover:shadow-[0_18px_44px_rgba(0,0,0,0.28)]",
        destructive: "border border-red-300/25 bg-red-500/24 text-white shadow-[0_14px_36px_rgba(185,28,28,0.22)] hover:bg-red-500/34",
        outline: "border border-white/18 bg-white/[0.07] text-foreground shadow-[0_10px_28px_rgba(0,0,0,0.16)] hover:border-white/30 hover:bg-white/14",
        secondary: "border border-white/16 bg-white/[0.09] text-foreground/85 shadow-[0_10px_30px_rgba(0,0,0,0.14)] hover:bg-white/[0.16] hover:text-foreground",
        ghost: "border border-transparent bg-transparent text-foreground/75 hover:border-white/16 hover:bg-white/[0.08] hover:text-foreground",
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
    if (asChild && React.Children.count(children) === 1 && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ className?: string; ref?: React.Ref<unknown> }>;
      return React.cloneElement(child, {
        ...props,
        className: cn(compClassName, child.props?.className),
        ref,
      });
    }
    return (
      <button
        className={compClassName}
        ref={ref}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
