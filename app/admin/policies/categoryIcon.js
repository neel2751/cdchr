import { createElement } from "react";
import {
  FolderOpen,
  Flame,
  GraduationCap,
  HeartPulse,
  Leaf,
  LockKeyhole,
  Monitor,
  PoundSterling,
  Scale,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";

/**
 * An icon for a category, guessed from its name.
 *
 * Categories are the company's own to name, so there is no field to store an
 * icon in and nothing to keep in step: the defaults and the obvious names get
 * a picture, anything else gets a folder. Fire before safety, so "Fire Safety"
 * is a flame rather than a shield.
 */
const RULES = [
  [/fire/, Flame],
  [/\bhr\b|people|staff|employ|conduct/, Users],
  [/\bit\b|tech|cyber|computer|device|software/, Monitor],
  [/financ|expense|account|purchas|payroll/, PoundSterling],
  [/data|gdpr|privacy|information/, LockKeyhole],
  [/health|first aid|wellbeing/, HeartPulse],
  [/safety|security|risk/, ShieldCheck],
  [/legal|complian|regulat|governance/, Scale],
  [/environment|sustainab|green/, Leaf],
  [/train|learn|induction/, GraduationCap],
  [/vehicle|driv|fleet|transport/, Truck],
];

export function CategoryIcon({ name = "", className }) {
  const key = String(name).toLowerCase();
  const icon = RULES.find(([pattern]) => pattern.test(key))?.[1] || FolderOpen;
  return createElement(icon, { className, "aria-hidden": true });
}
