"use client";

import { useEffect } from "react";
import "../../../lib/register-fields";

/**
 * Client component that ensures field registration happens on the client side
 * This component doesn't render anything, it just ensures the registration runs
 */
export function FieldRegistration() {
  useEffect(() => {
    // Registration happens when the module is imported
    // This effect just ensures the component mounted
  }, []);

  return null;
}
