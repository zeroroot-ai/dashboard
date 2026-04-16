import { Link2Icon, Mail, MapPin, PhoneCall } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function ProfileCard() {
  return (
    <Card className="relative">
      <CardContent>
        <div className="space-y-12">
          <div className="flex flex-col items-center space-y-4">
            <Avatar className="size-20">
              <AvatarImage src={`/images/avatars/10.png`} alt="@shadcn" />
              <AvatarFallback>AH</AvatarFallback>
            </Avatar>
            <div className="text-center">
              <h5 className="flex items-center gap-2 text-xl font-semibold">
                User <Badge variant="info">Pro</Badge>
              </h5>
              <div className="text-muted-foreground text-sm">Member</div>
            </div>
          </div>
          <div className="bg-muted grid grid-cols-3 divide-x rounded-md border text-center *:py-3">
            <div>
              <h5 className="text-lg font-semibold">184</h5>
              <div className="text-muted-foreground text-sm">Post</div>
            </div>
            <div>
              <h5 className="text-lg font-semibold">32</h5>
              <div className="text-muted-foreground text-sm">Projects</div>
            </div>
            <div>
              <h5 className="text-lg font-semibold">4.5K</h5>
              <div className="text-muted-foreground text-sm">Members</div>
            </div>
          </div>
          <div className="flex flex-col gap-y-4">
            <div className="flex items-center gap-3 text-sm">
              <Mail className="text-muted-foreground size-4" /> —
            </div>
            <div className="flex items-center gap-3 text-sm">
              <PhoneCall className="text-muted-foreground size-4" /> (+1-876) 8654 239 581
            </div>
            <div className="flex items-center gap-3 text-sm">
              <MapPin className="text-muted-foreground size-4" />
              Canada
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Link2Icon className="text-muted-foreground size-4" />
              <a
                href="https://bundui.io/"
                className="hover:text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer">
                https://bundui.io/
              </a>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
