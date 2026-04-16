"use client";

import { Briefcase } from "lucide-react";
import { useOnboardingStore } from "../store";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export function WorkPreferencesStep() {
  const { data, updateWorkPreferences, nextStep, prevStep } = useOnboardingStore();

  const handleNext = () => {
    const { workStyle, experience, availability } = data.workPreferences;
    if (workStyle && experience && availability) {
      nextStep();
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex gap-3">
        <div className="bg-primary flex size-8 items-center justify-center rounded-full">
          <Briefcase className="text-primary-foreground size-4" />
        </div>
        <h1 className="text-2xl font-bold">Tell us about your work style</h1>
      </div>

      <div className="space-y-8">
        <div className="space-y-4">
          <div className="font-medium">Preferred work style</div>
          <RadioGroup
            value={data.workPreferences.workStyle}
            onValueChange={(value) => updateWorkPreferences({ workStyle: value })}
            className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { value: "remote", label: "Remote", desc: "Work from anywhere", icon: "🏠" },
              { value: "hybrid", label: "Hybrid", desc: "Mix of remote and office", icon: "🔄" },
              {
                value: "office",
                label: "In-office",
                desc: "Traditional office setting",
                icon: "🏢"
              }
            ].map((option) => (
              <div key={option.value} className="relative">
                <RadioGroupItem value={option.value} id={option.value} className="peer sr-only" />
                <Label
                  htmlFor={option.value}
                  className="peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:border-primary hover:border-primary flex cursor-pointer flex-col items-center justify-center rounded-md border p-4 text-base">
                  <span className="text-2xl">{option.icon}</span>
                  <span className="font-semibold">{option.label}</span>
                  <span className="text-muted-foreground text-center text-sm">{option.desc}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-4">
          <div className="font-medium">Experience level</div>
          <RadioGroup
            value={data.workPreferences.experience}
            onValueChange={(value) => updateWorkPreferences({ experience: value })}
            className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { value: "entry", label: "Entry Level", desc: "0-2 years experience", icon: "🌱" },
              { value: "mid", label: "Mid Level", desc: "3-5 years experience", icon: "🚀" },
              { value: "senior", label: "Senior Level", desc: "6+ years experience", icon: "⭐" }
            ].map((option) => (
              <div key={option.value} className="relative">
                <RadioGroupItem value={option.value} id={option.value} className="peer sr-only" />
                <Label
                  htmlFor={option.value}
                  className="peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:border-primary hover:border-primary flex cursor-pointer flex-col items-center justify-center rounded-md border p-4 text-base">
                  <span className="text-2xl">{option.icon}</span>
                  <span className="font-semibold">{option.label}</span>
                  <span className="text-muted-foreground text-center text-sm">{option.desc}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-4">
          <div className="font-medium">Availability</div>
          <RadioGroup
            value={data.workPreferences.availability}
            onValueChange={(value) => updateWorkPreferences({ availability: value })}
            className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { value: "full-time", label: "Full-time", desc: "40+ hours per week", icon: "⏰" },
              {
                value: "part-time",
                label: "Part-time",
                desc: "20-30 hours per week",
                icon: "⏳"
              },
              { value: "contract", label: "Contract", desc: "Project-based work", icon: "📋" }
            ].map((option) => (
              <div key={option.value} className="relative">
                <RadioGroupItem value={option.value} id={option.value} className="peer sr-only" />
                <Label
                  htmlFor={option.value}
                  className="peer-data-[state=checked]:bg-primary/10 peer-data-[state=checked]:border-primary hover:border-primary flex cursor-pointer flex-col items-center justify-center rounded-md border p-4 text-base">
                  <span className="text-2xl">{option.icon}</span>
                  <span className="font-semibold">{option.label}</span>
                  <span className="text-muted-foreground text-center text-sm">{option.desc}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={prevStep}>
            Back
          </Button>
          <Button size="lg" onClick={handleNext}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
