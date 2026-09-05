import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"

import { RevealableInput } from "./revealable-input"

describe("RevealableInput", () => {
  describe("when type='password'", () => {
    it("renders the input with type='password' by default", () => {
      render(<RevealableInput type="password" aria-label="Secret" />)
      const input = screen.getByLabelText("Secret")
      expect(input).toHaveAttribute("type", "password")
    })

    it("renders the eye toggle button", () => {
      render(<RevealableInput type="password" aria-label="Secret" />)
      expect(screen.getByRole("button", { name: "Show secret value" })).toBeInTheDocument()
    })

    it("clicking the toggle reveals the value (type becomes 'text')", () => {
      render(<RevealableInput type="password" aria-label="Secret" />)
      const toggle = screen.getByRole("button", { name: "Show secret value" })
      fireEvent.click(toggle)
      const input = screen.getByLabelText("Secret")
      expect(input).toHaveAttribute("type", "text")
    })

    it("clicking the toggle a second time hides the value again", () => {
      render(<RevealableInput type="password" aria-label="Secret" />)
      const toggle = screen.getByRole("button", { name: "Show secret value" })
      fireEvent.click(toggle)
      const toggleAfterReveal = screen.getByRole("button", { name: "Hide secret value" })
      fireEvent.click(toggleAfterReveal)
      const input = screen.getByLabelText("Secret")
      expect(input).toHaveAttribute("type", "password")
    })

    it("aria-label is 'Show secret value' when hidden", () => {
      render(<RevealableInput type="password" aria-label="Secret" />)
      expect(screen.getByRole("button", { name: "Show secret value" })).toBeInTheDocument()
    })

    it("aria-label is 'Hide secret value' when revealed", () => {
      render(<RevealableInput type="password" aria-label="Secret" />)
      fireEvent.click(screen.getByRole("button", { name: "Show secret value" }))
      expect(screen.getByRole("button", { name: "Hide secret value" })).toBeInTheDocument()
    })

    it("starts revealed when defaultRevealed={true}", () => {
      render(<RevealableInput type="password" defaultRevealed aria-label="Secret" />)
      const input = screen.getByLabelText("Secret")
      expect(input).toHaveAttribute("type", "text")
      expect(screen.getByRole("button", { name: "Hide secret value" })).toBeInTheDocument()
    })

    it("forwards className to the input", () => {
      render(<RevealableInput type="password" className="font-mono" aria-label="Secret" />)
      const input = screen.getByLabelText("Secret")
      expect(input.className).toContain("font-mono")
    })

    it("forwards placeholder to the input", () => {
      render(<RevealableInput type="password" placeholder="Enter value" aria-label="Secret" />)
      expect(screen.getByPlaceholderText("Enter value")).toBeInTheDocument()
    })

    it("forwards disabled to the input", () => {
      render(<RevealableInput type="password" disabled aria-label="Secret" />)
      expect(screen.getByLabelText("Secret")).toBeDisabled()
    })

    it("forwards onChange to the input", () => {
      const handleChange = vi.fn()
      render(<RevealableInput type="password" onChange={handleChange} aria-label="Secret" />)
      fireEvent.change(screen.getByLabelText("Secret"), { target: { value: "abc" } })
      expect(handleChange).toHaveBeenCalledTimes(1)
    })

    it("input has pr-9 class to avoid text running behind the icon", () => {
      render(<RevealableInput type="password" aria-label="Secret" />)
      const input = screen.getByLabelText("Secret")
      expect(input.className).toContain("pr-9")
    })

    it("toggle button has type='button' to prevent form submission", () => {
      render(<RevealableInput type="password" aria-label="Secret" />)
      const toggle = screen.getByRole("button", { name: "Show secret value" })
      expect(toggle).toHaveAttribute("type", "button")
    })
  })

  describe("when type is not 'password'", () => {
    it("renders a plain input with no eye button", () => {
      render(<RevealableInput type="text" aria-label="Name" />)
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
    })

    it("forwards the original type through unchanged", () => {
      render(<RevealableInput type="email" aria-label="Email" />)
      expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email")
    })

    it("forwards className when type is not password", () => {
      render(<RevealableInput type="text" className="font-mono" aria-label="Name" />)
      expect(screen.getByLabelText("Name").className).toContain("font-mono")
    })
  })
})
