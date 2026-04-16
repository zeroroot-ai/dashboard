import { create } from "zustand";

export interface ActivityItem {
  id: string;
  type: "file-upload" | "status-update" | "card-added";
  title: string;
  description: string;
  timestamp: string;
  files?: Array<{ name: string; size: string; type: "excel" | "word" }>;
  badge?: { text: string; color: string };
  cards?: Array<{ id: string; color: string }>;
  link?: { text: string; id: string };
}

export interface Connection {
  id: string;
  name: string;
  avatar?: string;
  initials?: string;
  connections: number;
  status: "connected" | "pending";
  online?: boolean;
}

export interface Team {
  id: string;
  name: string;
  members: number;
}

export interface Project {
  id: string;
  name: string;
  icon: string;
  iconBg: string;
  progress: number;
  hoursSpent: string;
  updated: string;
}

interface ProfileState {
  user: {
    name: string;
    verified: boolean;
    avatar: string;
    role: string;
    location: string;
    joinedDate: string;
    email: string;
    phone: string;
    department: string;
    teams: number;
    projects: number;
    online: boolean;
  };
  profileCompletion: number;
  activities: ActivityItem[];
  connections: Connection[];
  teams: Team[];
  projects: Project[];
}

export const useProfileStore = create<ProfileState>(() => ({
  user: {
    name: "",
    verified: false,
    avatar: "",
    role: "",
    location: "",
    joinedDate: "",
    email: "",
    phone: "",
    department: "",
    teams: 0,
    projects: 0,
    online: true
  },
  profileCompletion: 82,
  activities: [],
  connections: [],
  teams: [],
  projects: []
}));
