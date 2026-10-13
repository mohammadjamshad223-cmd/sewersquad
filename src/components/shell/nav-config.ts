import {
  Smartphone,
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  FolderOpen,
  Gauge,
  History,
  LayoutDashboard,
  LifeBuoy,
  MapPin,
  Receipt,
  Route,
  Settings,
  Siren,
  Truck,
  User,
  UserPlus,
  Users,
  Wrench,
  Recycle,
  Inbox,
  FileSignature,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; permission?: string | string[]; badgeKey?: string };
export type NavGroup = { label?: string; items: NavItem[] };

export const ADMIN_NAV: NavGroup[] = [
  {
    items: [
      { href: "/admin/new-customer", label: "New Customer", icon: UserPlus, permission: "customers.write" },
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/dispatch", label: "Dispatch Board", icon: Route, permission: "jobs.read" },
      { href: "/admin/calendar", label: "Service Calendar", icon: CalendarDays, permission: "jobs.read" },
      // Shown only to staff with field mode on (pseudo-permission added by the admin layout).
      { href: "/driver/dashboard", label: "My Route (field mode)", icon: Smartphone, permission: "field.mode" },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/admin/customers", label: "Customers", icon: Building2, permission: "customers.read" },
      { href: "/admin/locations", label: "Service Locations", icon: MapPin, permission: "customers.read" },
      { href: "/admin/leads", label: "Leads & Inquiries", icon: Inbox, permission: "support.manage", badgeKey: "leads" },
      { href: "/admin/support", label: "Portal Messages", icon: LifeBuoy, permission: "support.manage", badgeKey: "support" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/jobs", label: "Jobs", icon: ClipboardList, permission: "jobs.read", badgeKey: "review" },
      { href: "/admin/emergencies", label: "Emergency Requests", icon: Siren, permission: "emergencies.manage", badgeKey: "emergencies" },
      { href: "/admin/drivers", label: "Drivers & Fleet", icon: Truck, permission: "fleet.read" },
      { href: "/admin/disposal", label: "Disposal", icon: Recycle, permission: "disposal.read" },
    ],
  },
  {
    label: "Records & Billing",
    items: [
      { href: "/admin/manifests", label: "Manifests", icon: ClipboardCheck, permission: "manifests.read" },
      { href: "/admin/invoices", label: "Invoices", icon: Receipt, permission: "invoices.read" },
      { href: "/admin/proposals", label: "Proposals & Quotes", icon: FileSignature, permission: "invoices.read" },
      { href: "/admin/service-reports", label: "Service Reports", icon: NotebookPen, permission: "jobs.read" },
      { href: "/admin/payments", label: "Payments", icon: CreditCard, permission: "payments.read" },
      { href: "/admin/documents", label: "Documents", icon: FolderOpen, permission: "documents.read" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/admin/reports", label: "Reports & Analytics", icon: BarChart3, permission: ["reports.operations", "reports.financial"] },
      { href: "/admin/notifications", label: "Notifications", icon: Bell },
      { href: "/admin/settings", label: "Settings", icon: Settings, permission: "settings.read" },
    ],
  },
];

export const CUSTOMER_NAV: NavGroup[] = [
  {
    items: [
      { href: "/customer/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/customer/services", label: "Upcoming Services", icon: CalendarDays },
      { href: "/customer/history", label: "Service History", icon: History },
      { href: "/customer/manifests", label: "Manifests", icon: ClipboardCheck },
      { href: "/customer/invoices", label: "Invoices & Payments", icon: Receipt },
      { href: "/customer/request-service", label: "Request Service", icon: AlertTriangle },
      { href: "/customer/locations", label: "Locations", icon: MapPin },
      { href: "/customer/documents", label: "Documents", icon: FileText },
      { href: "/customer/support", label: "Support", icon: LifeBuoy },
      { href: "/customer/notifications", label: "Notifications", icon: Bell },
      { href: "/customer/settings", label: "Account Settings", icon: Settings },
    ],
  },
];

export const DRIVER_NAV: NavItem[] = [
  { href: "/driver/dashboard", label: "Today", icon: Gauge },
  { href: "/driver/route", label: "Route", icon: Route },
  { href: "/driver/jobs", label: "Jobs", icon: ClipboardList },
  { href: "/driver/inspections", label: "Inspect", icon: Wrench },
  { href: "/driver/profile", label: "Profile", icon: User },
];

export const DRIVER_SECONDARY: NavItem[] = [
  { href: "/driver/history", label: "Service History", icon: History },
  { href: "/driver/disposal", label: "Disposal", icon: Recycle },
  { href: "/driver/issues", label: "Report Issue", icon: AlertTriangle },
  { href: "/driver/notifications", label: "Notifications", icon: Bell },
];

export const STAFF_ICON = Users;
