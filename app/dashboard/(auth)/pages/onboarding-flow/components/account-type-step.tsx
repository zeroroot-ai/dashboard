"use client";

import { Button } from "@/components/ui/button";
import { useOnboardingStore } from "../store";
import { User, Building2, Users, Briefcase } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const accountTypes = [
  {
    id: "individual",
    title: "Individual",
    description: "Perfect for personal projects and freelancers",
    icon: User,
    emoji: "👤",
    features: ["Personal dashboard", "Basic analytics", "Community access"],
    color: "from-green-500 to-emerald-500"
  },
  {
    id: "business",
    title: "Business",
    description: "Ideal for small to medium businesses",
    icon: Building2,
    emoji: "🏢",
    features: ["Team collaboration", "Advanced analytics", "Priority support"],
    color: "from-blue-500 to-indigo-500"
  },
  {
    id: "enterprise",
    title: "Enterprise",
    description: "For large organizations with advanced needs",
    icon: Users,
    emoji: "🏛️",
    features: ["Custom integrations", "Dedicated support", "Advanced security"],
    color: "from-purple-500 to-pink-500"
  }
];

export function AccountTypeStep() {
  const { prevStep } = useOnboardingStore();

  return (
    <div className="space-y-8">
      <div className="flex gap-3">
        <div className="bg-primary flex size-8 items-center justify-center rounded-full">
          <Briefcase className="text-primary-foreground size-4" />
        </div>
        <h1 className="text-2xl font-bold">Choose your account type</h1>
      </div>

      <div className="space-y-6">
        <RadioGroup className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {accountTypes.map((type) => {
            return (
              <div key={type.id} className="relative">
                <RadioGroupItem value={type.id} id={type.id} className="peer sr-only" />
                <Label
                  htmlFor={type.id}
                  className="peer-data-[state=checked]:bg-primary/5 peer-data-[state=checked]:border-primary hover:border-primary flex cursor-pointer flex-col items-start space-y-2 rounded-md border px-4 py-6">
                  <div className="text-3xl">{type.emoji}</div>
                  <h3 className="text-xl font-bold">{type.title}</h3>
                  <p className="text-muted-foreground">{type.description}</p>
                  <ul className="text-muted-foreground list-inside list-disc space-y-2">
                    {type.features.map((feature, index) => (
                      <li key={index}>{feature}</li>
                    ))}
                  </ul>
                </Label>
              </div>
            );
          })}
        </RadioGroup>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button size="lg">Continue</Button>
      </div>
    </div>
  );
}
