import * as React from "react";
import { motion } from "framer-motion";
import { type VariantProps } from "class-variance-authority";
import { Button, buttonVariants } from "./button";

interface AnimatedButtonProps
  extends React.ComponentProps<typeof Button>,
    VariantProps<typeof buttonVariants> {
  /**
   * Scale factor when button is pressed (default: 0.95)
   */
  tapScale?: number;
  /**
   * Animation duration in seconds (default: 0.1)
   */
  tapDuration?: number;
}

/**
 * AnimatedButton - A button component with haptic feedback animation
 * Wraps the standard Button component with framer-motion for tap animations
 */
const AnimatedButton = React.forwardRef<HTMLButtonElement, AnimatedButtonProps>(
  (
    {
      className,
      variant,
      size,
      tapScale = 0.95,
      tapDuration = 0.1,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <motion.div
        whileTap={disabled ? undefined : { scale: tapScale }}
        transition={{ duration: tapDuration, ease: "easeOut" }}
        style={{ display: "inline-flex" }}
      >
        <Button
          ref={ref}
          className={className}
          variant={variant}
          size={size}
          disabled={disabled}
          {...props}
        >
          {children}
        </Button>
      </motion.div>
    );
  }
);

AnimatedButton.displayName = "AnimatedButton";

export { AnimatedButton };
