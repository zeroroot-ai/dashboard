"use client";

import {
  Calendar,
  CheckIcon,
  ImagePlusIcon,
  MapPin,
  PencilIcon,
  TrendingUp,
  XIcon
} from "lucide-react";
import { useId } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCharacterLimit } from "@/hooks/use-character-limit";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useProfileStore } from "../store";

const DEFAULT_COVER_URL =
  "https://images.unsplash.com/photo-1735926199195-85b726600751?ixlib=rb-4.1.0&auto=format&fit=crop&q=80&w=1000";

function EditProfileModal() {
  const id = useId();
  const user = useProfileStore((state) => state.user);
  const [firstName, ...lastNameParts] = user.name.split(" ");
  const defaultLastName = lastNameParts.join(" ") || "";

  const maxLength = 180;
  const {
    value: bioValue,
    characterCount,
    handleChange: handleBioChange,
    maxLength: limit
  } = useCharacterLimit({
    initialValue: "Hey, I am a web developer who loves turning ideas into amazing websites!",
    maxLength
  });

  const initialBgImage = [
    {
      id: "profile-bg",
      name: "profile-bg.jpg",
      size: 0,
      type: "image/jpeg",
      url: DEFAULT_COVER_URL
    }
  ];

  const initialAvatarImage = [
    {
      id: "avatar",
      name: "avatar.jpg",
      size: 0,
      type: "image/jpeg",
      url: user.avatar
    }
  ];

  return (
    <DialogContent className="flex flex-col gap-0 overflow-y-visible p-0 sm:max-w-lg [&>button:last-child]:top-3.5">
      <DialogHeader className="contents space-y-0 text-left">
        <DialogTitle className="border-b px-6 py-4 font-normal">Edit Profile</DialogTitle>
      </DialogHeader>
      <DialogDescription className="sr-only">
        Make changes to your profile here. You can change your photo and set a username.
      </DialogDescription>
      <div className="overflow-y-auto">
        <ProfileBg initialFiles={initialBgImage} />
        <ProfileAvatar initialFiles={initialAvatarImage} />
        <div className="px-6 pt-4 pb-6">
          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex-1 space-y-2">
                <Label htmlFor={`${id}-first-name`}>First name</Label>
                <Input
                  defaultValue={firstName}
                  id={`${id}-first-name`}
                  placeholder="First name"
                  required
                  type="text"
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label htmlFor={`${id}-last-name`}>Last name</Label>
                <Input
                  defaultValue={defaultLastName}
                  id={`${id}-last-name`}
                  placeholder="Last name"
                  required
                  type="text"
                />
              </div>
            </div>
            <div className="*:not-first:mt-2">
              <Label htmlFor={`${id}-username`}>Username</Label>
              <div className="relative">
                <Input
                  className="peer pe-9"
                  defaultValue={user.name.toLowerCase().replace(/\s+/g, "-")}
                  id={`${id}-username`}
                  placeholder="Username"
                  required
                  type="text"
                />
                <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 end-0 flex items-center justify-center pe-3 peer-disabled:opacity-50">
                  <CheckIcon aria-hidden className="text-emerald-500" size={16} />
                </div>
              </div>
            </div>
            <div className="*:not-first:mt-2">
              <Label htmlFor={`${id}-website`}>Website</Label>
              <div className="flex rounded-md shadow-xs">
                <span className="border-input bg-background text-muted-foreground -z-10 inline-flex items-center rounded-s-md border px-3 text-sm">
                  https://
                </span>
                <Input
                  className="-ms-px rounded-s-none shadow-none"
                  defaultValue="www.example.com"
                  id={`${id}-website`}
                  placeholder="yourwebsite.com"
                  type="text"
                />
              </div>
            </div>
            <div className="*:not-first:mt-2">
              <Label htmlFor={`${id}-bio`}>Biography</Label>
              <Textarea
                aria-describedby={`${id}-description`}
                id={`${id}-bio`}
                maxLength={maxLength}
                onChange={handleBioChange}
                placeholder="Write a few sentences about yourself"
                value={bioValue}
              />
              <p
                aria-live="polite"
                className="text-muted-foreground mt-2 text-right text-xs"
                id={`${id}-description`}
                role="status">
                <span className="tabular-nums">{limit - characterCount}</span> characters left
              </p>
            </div>
          </form>
        </div>
      </div>
      <DialogFooter className="border-t px-6 py-4">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <DialogClose asChild>
          <Button type="button">Save changes</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}

type FileMetadata = {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
};

function ProfileBg({ initialFiles }: { initialFiles: FileMetadata[] }) {
  const [{ files }, { removeFile, openFileDialog, getInputProps }] = useFileUpload({
    accept: "image/*",
    initialFiles
  });

  const currentImage = files[0]?.preview ?? null;

  return (
    <div className="h-32">
      <div className="bg-muted relative flex size-full items-center justify-center overflow-hidden">
        {currentImage && (
          <img
            alt={files[0]?.preview ? "Upload preview" : "Default profile background"}
            className="size-full object-cover"
            height={96}
            src={currentImage}
            width={512}
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center gap-2">
          <button
            aria-label={currentImage ? "Change image" : "Upload image"}
            className="focus-visible:border-ring focus-visible:ring-ring/50 z-50 flex size-10 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition-[color,box-shadow] outline-none hover:bg-black/80 focus-visible:ring-[3px]"
            onClick={openFileDialog}
            type="button">
            <ImagePlusIcon aria-hidden size={16} />
          </button>
          {currentImage && (
            <button
              aria-label="Remove image"
              className="focus-visible:border-ring focus-visible:ring-ring/50 z-50 flex size-10 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition-[color,box-shadow] outline-none hover:bg-black/80 focus-visible:ring-[3px]"
              onClick={() => removeFile(files[0]?.id ?? "")}
              type="button">
              <XIcon aria-hidden size={16} />
            </button>
          )}
        </div>
      </div>
      <input {...getInputProps()} aria-label="Upload image file" className="sr-only" />
    </div>
  );
}

function ProfileAvatar({ initialFiles }: { initialFiles: FileMetadata[] }) {
  const [{ files }, { openFileDialog, getInputProps }] = useFileUpload({
    accept: "image/*",
    initialFiles
  });

  const currentImage = files[0]?.preview ?? null;

  return (
    <div className="-mt-10 px-6">
      <div className="border-background bg-muted relative flex size-20 items-center justify-center overflow-hidden rounded-full border-4 shadow-xs shadow-black/10">
        {currentImage && (
          <img
            alt="Profile"
            className="size-full object-cover"
            height={80}
            src={currentImage}
            width={80}
          />
        )}
        <button
          aria-label="Change profile picture"
          className="focus-visible:border-ring focus-visible:ring-ring/50 absolute flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition-[color,box-shadow] outline-none hover:bg-black/80 focus-visible:ring-[3px]"
          onClick={openFileDialog}
          type="button">
          <ImagePlusIcon aria-hidden size={16} />
        </button>
        <input {...getInputProps()} aria-label="Upload profile picture" className="sr-only" />
      </div>
    </div>
  );
}

export function ProfileHeader() {
  const user = useProfileStore((state) => state.user);

  return (
    <div className="relative">
      <div
        className="relative aspect-3/1 w-full rounded-t-md bg-cover bg-center md:max-h-[240px]"
        style={{ backgroundImage: `url('${DEFAULT_COVER_URL}')` }}>
        <div className="absolute end-4 top-4">
          <Dialog>
            <DialogTrigger asChild>
              <Button className="bg-background/50 rounded-full" size="icon-sm" variant="ghost">
                <PencilIcon />
              </Button>
            </DialogTrigger>
            <EditProfileModal />
          </Dialog>
        </div>
      </div>

      <div className="-mt-10 px-4 pb-4 text-center lg:-mt-14">
        <Avatar className="border-background mx-auto size-20 border-4 lg:size-28">
          <AvatarImage src={user.avatar} alt={user.name} />
          <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <div className="flex items-center justify-center gap-2">
          <h4 className="text-lg font-semibold lg:text-2xl">{user.name}</h4>
        </div>

        <div className="text-muted-foreground mt-3 flex items-center justify-center gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4" />
            <span>{user.role}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-4 w-4" />
            <span className="text-blue-500">{user.location}</span>
          </div>
          <div className="hidden items-center gap-1.5 lg:flex">
            <Calendar className="h-4 w-4" />
            <span>Joined {user.joinedDate}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
