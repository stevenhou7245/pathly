export type DashboardView =
  | "field"
  | "profile"
  | "friends"
  | "messages"
  | "study_rooms"
  | "more";

export type LearningFolder = {
  id: string;
  fieldId?: string;
  journeyPathId?: string | null;
  name: string;
  iconLabel: string;
  currentLevel: string;
  targetLevel: string;
  progress: number;
  nextMilestone: string;
  totalSteps: number;
  completedSteps: number;
};

export type FriendMessage = {
  id: number;
  from: "friend" | "me";
  text: string;
  time: string;
};

export type Friend = {
  id: string;
  name: string;
  learningField: string;
  progress: number;
  online: boolean;
  statusText: string;
  messages: FriendMessage[];
};

export const LEARNING_FOLDERS: LearningFolder[] = [
  {
    id: "web-dev",
    name: "Web Development",
    iconLabel: "WD",
    currentLevel: "Intermediate",
    targetLevel: "Advanced",
    progress: 68,
    nextMilestone: "Build a full-stack mini project",
    totalSteps: 24,
    completedSteps: 16,
  },
  {
    id: "ielts",
    name: "IELTS",
    iconLabel: "IE",
    currentLevel: "Basic",
    targetLevel: "Advanced",
    progress: 42,
    nextMilestone: "Reach speaking band 6.5 mock score",
    totalSteps: 20,
    completedSteps: 8,
  },
  {
    id: "ml",
    name: "Machine Learning",
    iconLabel: "ML",
    currentLevel: "Beginner",
    targetLevel: "Intermediate",
    progress: 27,
    nextMilestone: "Complete first model training challenge",
    totalSteps: 22,
    completedSteps: 6,
  },
];

export const FRIENDS: Friend[] = [
  {
    id: "friend-luca",
    name: "Luca",
    learningField: "Web Development",
    progress: 72,
    online: true,
    statusText: "Debugging APIs and loving it.",
    messages: [
      { id: 1, from: "friend", text: "Hey! Ready for today's challenge?", time: "10:08" },
      { id: 2, from: "me", text: "Yes, let's do the routing quest.", time: "10:10" },
      { id: 3, from: "friend", text: "Nice. I'll share my notes after lunch.", time: "10:12" },
    ],
  },
  {
    id: "friend-emma",
    name: "Emma",
    learningField: "IELTS",
    progress: 58,
    online: false,
    statusText: "Practicing speaking prompts this week.",
    messages: [
      { id: 1, from: "friend", text: "Could we review task 2 essays tomorrow?", time: "Yesterday" },
      { id: 2, from: "me", text: "Absolutely. I have a checklist ready.", time: "Yesterday" },
    ],
  },
  {
    id: "friend-noah",
    name: "Noah",
    learningField: "Machine Learning",
    progress: 35,
    online: true,
    statusText: "Learning feature engineering tricks.",
    messages: [
      { id: 1, from: "friend", text: "I finally got my model above 80%!", time: "09:32" },
      { id: 2, from: "me", text: "Great job! Share your approach?", time: "09:35" },
    ],
  },
];
