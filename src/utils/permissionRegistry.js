// src/utils/permissionRegistry.js
/**
 * Comprehensive Permission Registry for Tavari System
 * Organizes all permissions by module and category for the role management system
 */

export const PERMISSION_REGISTRY = {
  pos: {
    name: 'Point of Sale (POS)',
    icon: '🛒',
    description: 'Cash register, sales, and payment processing',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'pos.register.view', name: 'Register - View', description: 'Access the cash register screen (view only)', isDangerous: false },
          { key: 'pos.register.edit', name: 'Register - Edit', description: 'Perform register actions (sell, void, refund)', isDangerous: true },
          { key: 'pos.daily_deposit.view', name: 'Daily Deposit - View', description: 'View daily deposit page', isDangerous: false },
          { key: 'pos.daily_deposit.edit', name: 'Daily Deposit - Edit', description: 'Create or modify deposits', isDangerous: true },
          { key: 'pos.inventory.view', name: 'Inventory - View', description: 'View inventory page', isDangerous: false },
          { key: 'pos.inventory.edit', name: 'Inventory - Edit', description: 'Create or modify inventory records', isDangerous: true },
          { key: 'pos.categories.view', name: 'Categories - View', description: 'View product categories', isDangerous: false },
          { key: 'pos.categories.edit', name: 'Categories - Edit', description: 'Add/edit/delete categories', isDangerous: true },
          { key: 'pos.modifiers.view', name: 'Modifiers / Variants - View', description: 'View modifiers and variants', isDangerous: false },
          { key: 'pos.modifiers.edit', name: 'Modifiers / Variants - Edit', description: 'Add/edit/delete modifiers and variants', isDangerous: true },
          { key: 'pos.stations.view', name: 'Station Management - View', description: 'View stations/kiosks', isDangerous: false },
          { key: 'pos.stations.edit', name: 'Station Management - Edit', description: 'Add/edit/delete stations', isDangerous: true },
          { key: 'pos.kitchen_display.view', name: 'Kitchen Display - View', description: 'View kitchen display', isDangerous: false },
          { key: 'pos.kitchen_display.edit', name: 'Kitchen Display - Edit', description: 'Manage kitchen display settings', isDangerous: true },
          { key: 'pos.discounts.view', name: 'Discounts - View', description: 'View discounts', isDangerous: false },
          { key: 'pos.discounts.edit', name: 'Discounts - Edit', description: 'Create or modify discounts', isDangerous: true },
          { key: 'pos.receipts.view', name: 'Receipts - View', description: 'View receipts', isDangerous: false },
          { key: 'pos.receipts.edit', name: 'Receipts - Edit', description: 'Resend/reprint or modify receipt settings', isDangerous: true },
          { key: 'pos.settings.view', name: 'POS Settings - View', description: 'View POS settings page', isDangerous: false },
          { key: 'pos.settings.edit', name: 'POS Settings - Edit', description: 'Modify POS configuration', isDangerous: true },
          { key: 'pos.loyalty.view', name: 'Loyalty Settings - View', description: 'View loyalty settings', isDangerous: false },
          { key: 'pos.loyalty.edit', name: 'Loyalty Settings - Edit', description: 'Modify loyalty settings', isDangerous: true }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - Register',
        permissions: [
          { key: 'pos.sales.create', name: 'Create Sale', description: 'Ring up and process sales', isDangerous: false },
          { key: 'pos.sales.void', name: 'Void Sale', description: 'Cancel or void sales', isDangerous: true },
          { key: 'pos.sales.refund', name: 'Refund Sale', description: 'Issue refunds', isDangerous: true },
          { key: 'pos.cash.open_drawer', name: 'Open Drawer', description: 'Open cash drawer without sale', isDangerous: true },
          { key: 'pos.cash.count', name: 'Cash Counts', description: 'Perform cash counts', isDangerous: false },
          { key: 'pos.cash.deposit', name: 'Bank Deposits', description: 'Create/manage deposits', isDangerous: true },
          { key: 'pos.sales.view_all', name: 'View All Sales', description: 'View sales across staff', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Inventory',
        permissions: [
          { key: 'pos.inventory.item.create', name: 'Create Item', description: 'Create inventory items', isDangerous: false },
          { key: 'pos.inventory.item.update', name: 'Update Item', description: 'Edit inventory items', isDangerous: false },
          { key: 'pos.inventory.item.delete', name: 'Delete Item', description: 'Delete inventory items', isDangerous: true }
        ]
      },
      {
        name: 'Granular - Daily deposit',
        permissions: [
          { key: 'pos.daily_deposit.create', name: 'Create Deposit', description: 'Create a new daily deposit', isDangerous: false },
          { key: 'pos.daily_deposit.update', name: 'Update Deposit', description: 'Edit an existing daily deposit', isDangerous: false },
          { key: 'pos.daily_deposit.submit', name: 'Submit Deposit', description: 'Submit deposit for approval', isDangerous: false },
          { key: 'pos.daily_deposit.approve', name: 'Approve Deposit', description: 'Approve and lock a daily deposit', isDangerous: true },
          { key: 'pos.daily_deposit.view_history', name: 'View Deposit History', description: 'View historical deposits', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Categories',
        permissions: [
          { key: 'pos.categories.create', name: 'Create Category', description: 'Add new product categories', isDangerous: false },
          { key: 'pos.categories.update', name: 'Update Category', description: 'Edit product categories', isDangerous: false },
          { key: 'pos.categories.delete', name: 'Delete Category', description: 'Remove product categories', isDangerous: true },
          { key: 'pos.categories.reorder', name: 'Reorder Categories', description: 'Change category ordering', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Modifiers',
        permissions: [
          { key: 'pos.modifiers.create', name: 'Create Modifier', description: 'Add new modifiers/variants', isDangerous: false },
          { key: 'pos.modifiers.update', name: 'Update Modifier', description: 'Edit modifiers/variants', isDangerous: false },
          { key: 'pos.modifiers.delete', name: 'Delete Modifier', description: 'Remove modifiers/variants', isDangerous: true }
        ]
      },
      {
        name: 'Granular - Stations',
        permissions: [
          { key: 'pos.stations.create', name: 'Create Station', description: 'Add POS stations/kiosks', isDangerous: false },
          { key: 'pos.stations.update', name: 'Update Station', description: 'Edit station settings', isDangerous: false },
          { key: 'pos.stations.delete', name: 'Delete Station', description: 'Remove a station', isDangerous: true },
          { key: 'pos.stations.assign_roles', name: 'Assign Roles', description: 'Assign roles to stations', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Kitchen display',
        permissions: [
          { key: 'pos.kitchen_display.view_all_orders', name: 'View All Orders', description: 'View all kitchen orders', isDangerous: false },
          { key: 'pos.kitchen_display.mark_prepared', name: 'Mark Prepared', description: 'Mark items as prepared', isDangerous: false },
          { key: 'pos.kitchen_display.mark_done', name: 'Mark Done', description: 'Complete and bump orders', isDangerous: false },
          { key: 'pos.kitchen_display.recall', name: 'Recall Order', description: 'Recall an order from complete', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Discounts',
        permissions: [
          { key: 'pos.discounts.create', name: 'Create Discount', description: 'Create new discounts', isDangerous: true },
          { key: 'pos.discounts.update', name: 'Update Discount', description: 'Edit discounts', isDangerous: true },
          { key: 'pos.discounts.delete', name: 'Delete Discount', description: 'Remove discounts', isDangerous: true },
          { key: 'pos.discounts.apply_any', name: 'Apply Any Discount', description: 'Apply any available discount', isDangerous: true }
        ]
      },
      {
        name: 'Granular - Receipts',
        permissions: [
          { key: 'pos.receipts.reprint', name: 'Reprint Receipt', description: 'Reprint customer receipts', isDangerous: false },
          { key: 'pos.receipts.resend_email', name: 'Resend Receipt Email', description: 'Resend receipts via email', isDangerous: false },
          { key: 'pos.receipts.edit_memo', name: 'Edit Receipt Memo', description: 'Edit the memo on receipts', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Settings',
        permissions: [
          { key: 'pos.settings.terminals.manage', name: 'Manage Terminals', description: 'Add/remove/configure terminals', isDangerous: true },
          { key: 'pos.settings.taxes.override', name: 'Override Taxes', description: 'Override tax calculations', isDangerous: true },
          { key: 'pos.settings.hardware.configure', name: 'Configure Hardware', description: 'Manage printers/scales/cash drawers', isDangerous: true }
        ]
      },
      {
        name: 'Granular - Loyalty',
        permissions: [
          { key: 'pos.loyalty.rules.view', name: 'View Loyalty Rules', description: 'View loyalty calculation rules', isDangerous: false },
          { key: 'pos.loyalty.rules.edit', name: 'Edit Loyalty Rules', description: 'Modify loyalty rules', isDangerous: true },
          { key: 'pos.loyalty.points.adjust', name: 'Adjust Points', description: 'Manually adjust loyalty points', isDangerous: true },
          { key: 'pos.loyalty.redeem.override', name: 'Override Redemption', description: 'Override loyalty redemption requirements', isDangerous: true }
        ]
      },
      {
        name: 'Reports',
        permissions: [
          { key: 'pos.reports.view', name: 'View Reports', description: 'Access POS reports', isDangerous: false },
          { key: 'pos.reports.export', name: 'Export Reports', description: 'Export report data', isDangerous: false }
        ]
      }
    ]
  },

  inventory: {
    name: 'Inventory Management',
    icon: '📦',
    description: 'Stock tracking, ordering, and supplier management',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'inventory.stock.view', name: 'Stock Management - View', description: 'Access the stock management page (view only)', isDangerous: false },
          { key: 'inventory.stock.edit', name: 'Stock Management - Edit', description: 'Perform stock management actions', isDangerous: true },
          { key: 'inventory.purchasing.view', name: 'Purchasing - View', description: 'View purchasing page', isDangerous: false },
          { key: 'inventory.purchasing.edit', name: 'Purchasing - Edit', description: 'Create or modify purchase orders', isDangerous: true },
          { key: 'inventory.suppliers.view', name: 'Suppliers - View', description: 'View suppliers page', isDangerous: false },
          { key: 'inventory.suppliers.edit', name: 'Suppliers - Edit', description: 'Add/edit/delete suppliers', isDangerous: true },
          { key: 'inventory.reports.view', name: 'Reports - View', description: 'View inventory reports', isDangerous: false },
          { key: 'inventory.reports.edit', name: 'Reports - Edit', description: 'Export and manage reports', isDangerous: false }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - Stock Management',
        permissions: [
          { key: 'inventory.stock.adjust', name: 'Adjust Stock', description: 'Manually adjust inventory quantities', isDangerous: true },
          { key: 'inventory.stock.receive', name: 'Receive Stock', description: 'Process incoming inventory shipments', isDangerous: false },
          { key: 'inventory.stock.transfer', name: 'Transfer Stock', description: 'Transfer inventory between locations', isDangerous: false },
          { key: 'inventory.stock.count', name: 'Perform Stock Counts', description: 'Perform physical inventory counts', isDangerous: false },
          { key: 'inventory.stock.view_low_stock', name: 'View Low Stock Alerts', description: 'View low stock warnings and alerts', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Purchasing',
        permissions: [
          { key: 'inventory.purchase.create', name: 'Create Purchase Orders', description: 'Create and submit purchase orders', isDangerous: false },
          { key: 'inventory.purchase.approve', name: 'Approve Purchase Orders', description: 'Approve purchase orders for processing', isDangerous: true },
          { key: 'inventory.purchase.cancel', name: 'Cancel Purchase Orders', description: 'Cancel pending purchase orders', isDangerous: true },
          { key: 'inventory.purchase.receive', name: 'Receive Purchase Orders', description: 'Mark purchase orders as received', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Suppliers',
        permissions: [
          { key: 'inventory.suppliers.create', name: 'Create Suppliers', description: 'Add new suppliers', isDangerous: false },
          { key: 'inventory.suppliers.update', name: 'Update Suppliers', description: 'Edit supplier information', isDangerous: false },
          { key: 'inventory.suppliers.delete', name: 'Delete Suppliers', description: 'Remove suppliers from system', isDangerous: true },
          { key: 'inventory.suppliers.manage', name: 'Manage Suppliers', description: 'Full supplier management access', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Reports',
        permissions: [
          { key: 'inventory.reports.export', name: 'Export Reports', description: 'Export inventory report data', isDangerous: false },
          { key: 'inventory.reports.view_cost', name: 'View Cost Reports', description: 'View cost and valuation reports', isDangerous: false }
        ]
      }
    ]
  },

  hr: {
    name: 'Human Resources',
    icon: '👥',
    description: 'Employee management, payroll, and HR administration',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'hr.employees.view', name: 'Employee Management - View', description: 'Access the employee management page (view only)', isDangerous: false },
          { key: 'hr.employees.edit', name: 'Employee Management - Edit', description: 'Perform employee management actions', isDangerous: true },
          { key: 'hr.payroll.view', name: 'Payroll - View', description: 'View payroll page', isDangerous: false },
          { key: 'hr.payroll.edit', name: 'Payroll - Edit', description: 'Process and manage payroll', isDangerous: true },
          { key: 'hr.documents.view', name: 'Documents - View', description: 'View documents page', isDangerous: false },
          { key: 'hr.documents.edit', name: 'Documents - Edit', description: 'Upload/delete employee documents', isDangerous: true },
          { key: 'hr.scheduling.view', name: 'Scheduling - View', description: 'View scheduling page', isDangerous: false },
          { key: 'hr.scheduling.edit', name: 'Scheduling - Edit', description: 'Create and manage schedules', isDangerous: true },
          { key: 'hr.time_off.view', name: 'Time Off - View', description: 'View time off requests', isDangerous: false },
          { key: 'hr.time_off.edit', name: 'Time Off - Edit', description: 'Approve/deny time off requests', isDangerous: true }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - Employee Management',
        permissions: [
          { key: 'hr.employees.view_all', name: 'View All Employees', description: 'View all employee profiles and information', isDangerous: false },
          { key: 'hr.employees.create', name: 'Create Employees', description: 'Add new employees to the system', isDangerous: false },
          { key: 'hr.employees.update', name: 'Update Employees', description: 'Modify employee information', isDangerous: false },
          { key: 'hr.employees.terminate', name: 'Terminate Employees', description: 'Terminate employee accounts', isDangerous: true },
          { key: 'hr.employees.view_own_profile', name: 'View Own Profile', description: 'View own employee profile', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Payroll',
        permissions: [
          { key: 'hr.payroll.process', name: 'Process Payroll', description: 'Calculate and process employee payroll', isDangerous: true },
          { key: 'hr.payroll.view_reports', name: 'View Payroll Reports', description: 'Access payroll reports and analytics', isDangerous: false },
          { key: 'hr.payroll.export', name: 'Export Payroll Data', description: 'Export payroll data and reports', isDangerous: false },
          { key: 'hr.wages.view', name: 'View Wages', description: 'View employee wage information', isDangerous: false },
          { key: 'hr.wages.edit', name: 'Edit Wages', description: 'Modify employee wage rates', isDangerous: true }
        ]
      },
      {
        name: 'Granular - Documents',
        permissions: [
          { key: 'hr.documents.upload', name: 'Upload Documents', description: 'Upload new employee documents', isDangerous: false },
          { key: 'hr.documents.delete', name: 'Delete Documents', description: 'Remove employee documents', isDangerous: true },
          { key: 'hr.documents.download', name: 'Download Documents', description: 'Download employee documents', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Scheduling',
        permissions: [
          { key: 'hr.scheduling.create', name: 'Create Schedules', description: 'Create new employee schedules', isDangerous: false },
          { key: 'hr.scheduling.edit', name: 'Edit Schedules', description: 'Modify existing schedules', isDangerous: false },
          { key: 'hr.scheduling.delete', name: 'Delete Schedules', description: 'Delete schedules', isDangerous: true },
          { key: 'hr.scheduling.view_all', name: 'View All Schedules', description: 'View schedules for all employees', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Time Off',
        permissions: [
          { key: 'hr.time_off.request', name: 'Request Time Off', description: 'Submit time off requests', isDangerous: false },
          { key: 'hr.time_off.approve', name: 'Approve Time Off', description: 'Approve time off requests', isDangerous: true },
          { key: 'hr.time_off.deny', name: 'Deny Time Off', description: 'Deny time off requests', isDangerous: true },
          { key: 'hr.time_off.view_all', name: 'View All Requests', description: 'View all time off requests', isDangerous: false }
        ]
      }
    ]
  },

  customers: {
    name: 'Customer Management',
    icon: '🙋',
    description: 'Customer profiles, loyalty, and CRM',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'pos.customers.view', name: 'Customer Management - View', description: 'Access the customer management page (view only)', isDangerous: false },
          { key: 'pos.customers.edit', name: 'Customer Management - Edit', description: 'Perform customer management actions', isDangerous: true }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - Customer Management',
        permissions: [
          { key: 'pos.customers.create', name: 'Create Customers', description: 'Add new customer accounts', isDangerous: false },
          { key: 'pos.customers.update', name: 'Update Customers', description: 'Modify customer information', isDangerous: false },
          { key: 'pos.customers.delete', name: 'Delete Customers', description: 'Remove customer accounts', isDangerous: true },
          { key: 'pos.customers.view_transactions', name: 'View Transactions', description: 'View customer transaction history', isDangerous: false },
          { key: 'pos.customers.view_loyalty', name: 'View Loyalty History', description: 'View customer loyalty point history', isDangerous: false },
          { key: 'pos.customers.adjust_points', name: 'Adjust Loyalty Points', description: 'Manually adjust customer loyalty points', isDangerous: true },
          { key: 'pos.customers.manage', name: 'Full Customer Management', description: 'Complete access to all customer management features', isDangerous: true }
        ]
      }
    ]
  },

  dining: {
    name: 'Dining Management',
    icon: '🍽️',
    description: 'Table management, floor plans, and reservations',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'dining.dashboard.view', name: 'Dining Dashboard - View', description: 'Access the dining dashboard (view only)', isDangerous: false },
          { key: 'dining.dashboard.edit', name: 'Dining Dashboard - Edit', description: 'Perform dining dashboard actions', isDangerous: true },
          { key: 'dining.table_map.view', name: 'Table Map - View', description: 'View table map page', isDangerous: false },
          { key: 'dining.table_map.edit', name: 'Table Map - Edit', description: 'Manage tables and table status', isDangerous: true },
          { key: 'dining.floor_editor.view', name: 'Floor Editor - View', description: 'View floor plan editor', isDangerous: false },
          { key: 'dining.floor_editor.edit', name: 'Floor Editor - Edit', description: 'Edit floor plan layout', isDangerous: true },
          { key: 'dining.reservations.view', name: 'Reservations - View', description: 'View reservations page', isDangerous: false },
          { key: 'dining.reservations.edit', name: 'Reservations - Edit', description: 'Create and manage reservations', isDangerous: true },
          { key: 'dining.table_order.view', name: 'Table Orders - View', description: 'View table orders page', isDangerous: false },
          { key: 'dining.table_order.edit', name: 'Table Orders - Edit', description: 'Create and manage table orders', isDangerous: true }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - Table Map',
        permissions: [
          { key: 'dining.tables.view', name: 'View Tables', description: 'View table map and table status', isDangerous: false },
          { key: 'dining.tables.create', name: 'Create Tables', description: 'Add new tables to floor plan', isDangerous: false },
          { key: 'dining.tables.update', name: 'Update Tables', description: 'Modify table properties and positions', isDangerous: false },
          { key: 'dining.tables.delete', name: 'Delete Tables', description: 'Remove tables from floor plan', isDangerous: true },
          { key: 'dining.tables.close', name: 'Close Tables', description: 'Close out and settle table orders', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Floor Editor',
        permissions: [
          { key: 'dining.floorplan.view', name: 'View Floor Plan', description: 'View dining room floor plan', isDangerous: false },
          { key: 'dining.floorplan.edit', name: 'Edit Floor Plan', description: 'Modify floor plan layout and objects', isDangerous: true },
          { key: 'dining.floorplan.save', name: 'Save Floor Plan', description: 'Save floor plan changes', isDangerous: true }
        ]
      },
      {
        name: 'Granular - Reservations',
        permissions: [
          { key: 'dining.reservations.create', name: 'Create Reservations', description: 'Book new table reservations', isDangerous: false },
          { key: 'dining.reservations.update', name: 'Update Reservations', description: 'Modify existing reservations', isDangerous: false },
          { key: 'dining.reservations.cancel', name: 'Cancel Reservations', description: 'Cancel table reservations', isDangerous: true },
          { key: 'dining.reservations.view_all', name: 'View All Reservations', description: 'View all table reservations', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Table Orders',
        permissions: [
          { key: 'dining.orders.create', name: 'Create Table Orders', description: 'Start new orders for tables', isDangerous: false },
          { key: 'dining.orders.view', name: 'View Table Orders', description: 'View active table orders', isDangerous: false },
          { key: 'dining.orders.update', name: 'Update Table Orders', description: 'Modify items on table orders', isDangerous: false },
          { key: 'dining.orders.delete', name: 'Delete Table Orders', description: 'Delete table orders', isDangerous: true },
          { key: 'dining.orders.close', name: 'Close Table Orders', description: 'Close and settle table orders', isDangerous: false }
        ]
      }
    ]
  },

  bookings: {
    name: 'Bookings & Events',
    icon: '📅',
    description: 'Event bookings, party packages, and scheduling',
    categories: [
      {
        name: 'Booking Management',
        permissions: [
          {
            key: 'bookings.view',
            name: 'View Bookings',
            description: 'View all bookings and reservations',
            isDangerous: false
          },
          {
            key: 'bookings.view_all',
            name: 'View All Bookings',
            description: 'Access all booking records across dashboard views',
            isDangerous: false
          },
          {
            key: 'bookings.calendar.view',
            name: 'View Booking Calendar',
            description: 'Access the booking schedule and calendar views',
            isDangerous: false
          },
          {
            key: 'bookings.create',
            name: 'Create Bookings',
            description: 'Create new bookings and reservations',
            isDangerous: false
          },
          {
            key: 'bookings.edit',
            name: 'Edit Bookings',
            description: 'Modify existing bookings',
            isDangerous: false
          },
          {
            key: 'bookings.cancel',
            name: 'Cancel Bookings',
            description: 'Cancel bookings and process refunds',
            isDangerous: true
          },
          {
            key: 'bookings.checkin',
            name: 'Check In Bookings',
            description: 'Mark guests as arrived for their booking',
            isDangerous: false
          }
        ]
      },
      {
        name: 'Booking Settings',
        permissions: [
          {
            key: 'bookings.settings.edit',
            name: 'Manage Booking Settings',
            description: 'Edit booking configuration, schedules, and resources',
            isDangerous: true
          }
        ]
      },
      {
        name: 'Party Packages',
        permissions: [
          {
            key: 'bookings.packages.manage',
            name: 'Manage Packages',
            description: 'Create and modify party packages',
            isDangerous: false
          },
          {
            key: 'bookings.pricing.override',
            name: 'Override Pricing',
            description: 'Override package pricing and deposits',
            isDangerous: true
          }
        ]
      }
    ]
  },

  waivers: {
    name: 'Waivers & Forms',
    icon: '📋',
    description: 'Digital waivers and liability forms',
    categories: [
      {
        name: 'Waiver Management',
        permissions: [
          {
            key: 'waivers.view',
            name: 'View Waivers',
            description: 'View signed waivers and forms',
            isDangerous: false
          },
          {
            key: 'waivers.create',
            name: 'Create Waivers',
            description: 'Create new waiver forms',
            isDangerous: false
          },
          {
            key: 'waivers.edit',
            name: 'Edit Waivers',
            description: 'Modify waiver templates',
            isDangerous: true
          },
          {
            key: 'waivers.reopen',
            name: 'Reopen Waivers',
            description: 'Reopen expired waivers for amendments',
            isDangerous: true
          }
        ]
      }
    ]
  },

  music: {
    name: 'Music System',
    icon: '🎵',
    description: 'Music library, playlists, and ad management',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'music.dashboard.view', name: 'Music Dashboard - View', description: 'Access the music dashboard (view only)', isDangerous: false },
          { key: 'music.dashboard.edit', name: 'Music Dashboard - Edit', description: 'Perform music dashboard actions', isDangerous: true },
          { key: 'music.upload.view', name: 'Music Upload - View', description: 'View music upload page', isDangerous: false },
          { key: 'music.upload.edit', name: 'Music Upload - Edit', description: 'Upload music tracks', isDangerous: false },
          { key: 'music.library.view', name: 'Music Library - View', description: 'View music library page', isDangerous: false },
          { key: 'music.library.edit', name: 'Music Library - Edit', description: 'Manage music library', isDangerous: true },
          { key: 'music.playlists.view', name: 'Playlists - View', description: 'View playlists page', isDangerous: false },
          { key: 'music.playlists.edit', name: 'Playlists - Edit', description: 'Create and manage playlists', isDangerous: true },
          { key: 'music.schedules.view', name: 'Schedules - View', description: 'View playlist schedules', isDangerous: false },
          { key: 'music.schedules.edit', name: 'Schedules - Edit', description: 'Create and manage schedules', isDangerous: true },
          { key: 'music.system_monitor.view', name: 'System Monitor - View', description: 'View system monitor page', isDangerous: false },
          { key: 'music.system_monitor.edit', name: 'System Monitor - Edit', description: 'Manage system monitor settings', isDangerous: true },
          { key: 'music.ads.view', name: 'Ad Management - View', description: 'View ad management pages', isDangerous: false },
          { key: 'music.ads.edit', name: 'Ad Management - Edit', description: 'Manage ads and revenue', isDangerous: true },
          { key: 'music.settings.view', name: 'Music Settings - View', description: 'View music settings', isDangerous: false },
          { key: 'music.settings.edit', name: 'Music Settings - Edit', description: 'Modify music system settings', isDangerous: true }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - Music Library',
        permissions: [
          { key: 'music.library.view_tracks', name: 'View Tracks', description: 'View music tracks in library', isDangerous: false },
          { key: 'music.library.upload', name: 'Upload Tracks', description: 'Upload new music tracks', isDangerous: false },
          { key: 'music.library.update', name: 'Update Tracks', description: 'Edit track metadata', isDangerous: false },
          { key: 'music.library.delete', name: 'Delete Tracks', description: 'Remove tracks from library', isDangerous: true },
          { key: 'music.library.manage', name: 'Full Library Management', description: 'Complete access to library management', isDangerous: true }
        ]
      },
      {
        name: 'Granular - Playlists',
        permissions: [
          { key: 'music.playlists.create', name: 'Create Playlists', description: 'Create new playlists', isDangerous: false },
          { key: 'music.playlists.update', name: 'Update Playlists', description: 'Modify playlist content and settings', isDangerous: false },
          { key: 'music.playlists.delete', name: 'Delete Playlists', description: 'Remove playlists', isDangerous: true },
          { key: 'music.playlists.manage_tracks', name: 'Manage Playlist Tracks', description: 'Add/remove tracks from playlists', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Schedules',
        permissions: [
          { key: 'music.schedules.create', name: 'Create Schedules', description: 'Create new playlist schedules', isDangerous: false },
          { key: 'music.schedules.update', name: 'Update Schedules', description: 'Modify schedule times and settings', isDangerous: false },
          { key: 'music.schedules.delete', name: 'Delete Schedules', description: 'Remove schedules', isDangerous: true },
          { key: 'music.schedules.activate', name: 'Activate Schedules', description: 'Activate/deactivate schedules', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Ad Management',
        permissions: [
          { key: 'music.ads.view_dashboard', name: 'View Ad Dashboard', description: 'View ad performance dashboard', isDangerous: false },
          { key: 'music.ads.view_revenue', name: 'View Revenue Reports', description: 'View ad revenue reports', isDangerous: false },
          { key: 'music.ads.view_payouts', name: 'View Payouts', description: 'View payout history', isDangerous: false },
          { key: 'music.ads.upload', name: 'Upload Ads', description: 'Upload advertisement content', isDangerous: false },
          { key: 'music.ads.manage_settings', name: 'Manage Ad Settings', description: 'Configure ad frequency and settings', isDangerous: true },
          { key: 'music.ads.manage', name: 'Full Ad Management', description: 'Complete access to ad management', isDangerous: true }
        ]
      }
    ]
  },

  mail: {
    name: 'Email Marketing',
    icon: '📧',
    description: 'Email campaigns, contacts, and automation',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'mail.dashboard.view', name: 'Mail Dashboard - View', description: 'Access the mail dashboard (view only)', isDangerous: false },
          { key: 'mail.dashboard.edit', name: 'Mail Dashboard - Edit', description: 'Perform mail dashboard actions', isDangerous: true },
          { key: 'mail.campaigns.view', name: 'Campaigns - View', description: 'View campaigns page', isDangerous: false },
          { key: 'mail.campaigns.edit', name: 'Campaigns - Edit', description: 'Create and manage campaigns', isDangerous: true },
          { key: 'mail.contacts.view', name: 'Contacts - View', description: 'View contacts page', isDangerous: false },
          { key: 'mail.contacts.edit', name: 'Contacts - Edit', description: 'Manage contacts', isDangerous: true },
          { key: 'mail.builder.view', name: 'Campaign Builder - View', description: 'View campaign builder', isDangerous: false },
          { key: 'mail.builder.edit', name: 'Campaign Builder - Edit', description: 'Create and edit campaigns', isDangerous: true },
          { key: 'mail.templates.view', name: 'Templates - View', description: 'View email templates', isDangerous: false },
          { key: 'mail.templates.edit', name: 'Templates - Edit', description: 'Create and manage templates', isDangerous: true },
          { key: 'mail.compliance.view', name: 'Compliance - View', description: 'View compliance center', isDangerous: false },
          { key: 'mail.compliance.edit', name: 'Compliance - Edit', description: 'Manage compliance settings', isDangerous: true },
          { key: 'mail.billing.view', name: 'Billing - View', description: 'View billing and usage', isDangerous: false },
          { key: 'mail.billing.edit', name: 'Billing - Edit', description: 'Manage billing settings', isDangerous: true },
          { key: 'mail.settings.view', name: 'Mail Settings - View', description: 'View mail settings', isDangerous: false },
          { key: 'mail.settings.edit', name: 'Mail Settings - Edit', description: 'Modify mail system settings', isDangerous: true },
          { key: 'mail.logs.view', name: 'Send Logs - View', description: 'View email send logs', isDangerous: false },
          { key: 'mail.performance.view', name: 'Performance - View', description: 'View performance monitoring', isDangerous: false }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - Campaigns',
        permissions: [
          { key: 'mail.campaigns.create', name: 'Create Campaigns', description: 'Create new email campaigns', isDangerous: false },
          { key: 'mail.campaigns.update', name: 'Update Campaigns', description: 'Modify draft campaigns', isDangerous: false },
          { key: 'mail.campaigns.delete', name: 'Delete Campaigns', description: 'Remove campaigns', isDangerous: true },
          { key: 'mail.campaigns.send', name: 'Send Campaigns', description: 'Send email campaigns', isDangerous: true },
          { key: 'mail.campaigns.send_test', name: 'Send Test Emails', description: 'Send test emails', isDangerous: false },
          { key: 'mail.campaigns.view_all', name: 'View All Campaigns', description: 'View campaigns across all users', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Contacts',
        permissions: [
          { key: 'mail.contacts.create', name: 'Create Contacts', description: 'Add new contacts', isDangerous: false },
          { key: 'mail.contacts.update', name: 'Update Contacts', description: 'Edit contact information', isDangerous: false },
          { key: 'mail.contacts.delete', name: 'Delete Contacts', description: 'Remove contacts', isDangerous: true },
          { key: 'mail.contacts.import', name: 'Import Contacts', description: 'Import contact lists from files', isDangerous: false },
          { key: 'mail.contacts.export', name: 'Export Contacts', description: 'Export contact data', isDangerous: true },
          { key: 'mail.contacts.manage_segments', name: 'Manage Segments', description: 'Create and manage contact segments', isDangerous: false }
        ]
      }
    ]
  },

  inbox: {
    name: 'Tavari Inbox',
    icon: '📬',
    description: 'Email hosting, domain management, and mailboxes',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'inbox.dashboard.view', name: 'Inbox Dashboard - View', description: 'Access the inbox dashboard (view only)', isDangerous: false },
          { key: 'inbox.dashboard.edit', name: 'Inbox Dashboard - Edit', description: 'Perform inbox dashboard actions', isDangerous: true },
          { key: 'inbox.domains.view', name: 'Domain Management - View', description: 'View domain management page', isDangerous: false },
          { key: 'inbox.domains.edit', name: 'Domain Management - Edit', description: 'Manage email domains', isDangerous: true },
          { key: 'inbox.mailboxes.view', name: 'Mailboxes - View', description: 'View mailboxes page', isDangerous: false },
          { key: 'inbox.mailboxes.edit', name: 'Mailboxes - Edit', description: 'Manage mailboxes', isDangerous: true },
          { key: 'inbox.settings.view', name: 'Inbox Settings - View', description: 'View inbox settings', isDangerous: false },
          { key: 'inbox.settings.edit', name: 'Inbox Settings - Edit', description: 'Modify inbox system settings', isDangerous: true }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - Domain Management',
        permissions: [
          { key: 'inbox.domains.add', name: 'Add Domains', description: 'Add new email domains', isDangerous: false },
          { key: 'inbox.domains.verify', name: 'Verify Domains', description: 'Verify domain ownership', isDangerous: false },
          { key: 'inbox.domains.delete', name: 'Delete Domains', description: 'Remove domains', isDangerous: true },
          { key: 'inbox.domains.manage_dns', name: 'Manage DNS Records', description: 'Configure DNS records for domains', isDangerous: true }
        ]
      },
      {
        name: 'Granular - Mailboxes',
        permissions: [
          { key: 'inbox.mailboxes.create', name: 'Create Mailboxes', description: 'Create new email mailboxes', isDangerous: false },
          { key: 'inbox.mailboxes.update', name: 'Update Mailboxes', description: 'Modify mailbox settings', isDangerous: false },
          { key: 'inbox.mailboxes.delete', name: 'Delete Mailboxes', description: 'Remove mailboxes', isDangerous: true },
          { key: 'inbox.mailboxes.manage_shares', name: 'Manage Shared Mailboxes', description: 'Configure shared mailbox access', isDangerous: true },
          { key: 'inbox.mailboxes.manage_forwarding', name: 'Manage Forwarding', description: 'Configure email forwarding rules', isDangerous: false }
        ]
      }
    ]
  },

  reports: {
    name: 'Reports & Analytics',
    icon: '📊',
    description: 'Business reports, analytics, and insights',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'reports.dashboard.view', name: 'Reports Dashboard - View', description: 'Access the reports dashboard (view only)', isDangerous: false },
          { key: 'reports.dashboard.edit', name: 'Reports Dashboard - Edit', description: 'Perform report dashboard actions', isDangerous: true },
          { key: 'reports.pos.view', name: 'POS Reports - View', description: 'View POS reports page', isDangerous: false },
          { key: 'reports.pos.edit', name: 'POS Reports - Edit', description: 'Generate and manage POS reports', isDangerous: true },
          { key: 'reports.hr.view', name: 'HR Reports - View', description: 'View HR reports page', isDangerous: false },
          { key: 'reports.hr.edit', name: 'HR Reports - Edit', description: 'Generate and manage HR reports', isDangerous: true },
          { key: 'reports.music.view', name: 'Music Reports - View', description: 'View music reports page', isDangerous: false },
          { key: 'reports.music.edit', name: 'Music Reports - Edit', description: 'Generate and manage music reports', isDangerous: true },
          { key: 'reports.mail.view', name: 'Mail Reports - View', description: 'View mail reports page', isDangerous: false },
          { key: 'reports.mail.edit', name: 'Mail Reports - Edit', description: 'Generate and manage mail reports', isDangerous: true },
          { key: 'reports.overview.view', name: 'Business Overview - View', description: 'View business overview dashboard', isDangerous: false },
          { key: 'reports.overview.edit', name: 'Business Overview - Edit', description: 'Configure business overview settings', isDangerous: true },
          { key: 'reports.automation.view', name: 'Report Automation - View', description: 'View report automation settings', isDangerous: false },
          { key: 'reports.automation.edit', name: 'Report Automation - Edit', description: 'Configure automated report schedules', isDangerous: true }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - POS Reports',
        permissions: [
          { key: 'reports.pos.sales', name: 'View Sales Reports', description: 'Access sales and revenue reports', isDangerous: false },
          { key: 'reports.pos.financial', name: 'View Financial Reports', description: 'Access financial and tax reports', isDangerous: false },
          { key: 'reports.pos.inventory', name: 'View Inventory Reports', description: 'Access inventory and product reports', isDangerous: false },
          { key: 'reports.pos.employee', name: 'View Employee Reports', description: 'Access employee performance reports', isDangerous: false },
          { key: 'reports.pos.customer', name: 'View Customer Reports', description: 'Access customer analytics reports', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Report Actions',
        permissions: [
          { key: 'reports.export', name: 'Export Reports', description: 'Export reports to PDF, CSV, Excel', isDangerous: false },
          { key: 'reports.email', name: 'Email Reports', description: 'Email reports to recipients', isDangerous: false },
          { key: 'reports.schedule', name: 'Schedule Reports', description: 'Create automated report schedules', isDangerous: true },
          { key: 'reports.delete', name: 'Delete Reports', description: 'Delete saved or scheduled reports', isDangerous: true }
        ]
      }
    ]
  },

  settings: {
    name: 'System Settings',
    icon: '⚙️',
    description: 'Business settings, roles, and configuration',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'settings.basic_info.view', name: 'Basic Info - View', description: 'View basic business information', isDangerous: false },
          { key: 'settings.basic_info.edit', name: 'Basic Info - Edit', description: 'Modify basic business information', isDangerous: true },
          { key: 'settings.operating_hours.view', name: 'Operating Hours - View', description: 'View operating hours settings', isDangerous: false },
          { key: 'settings.operating_hours.edit', name: 'Operating Hours - Edit', description: 'Modify operating hours', isDangerous: true },
          { key: 'settings.holiday_hours.view', name: 'Holiday Hours - View', description: 'View holiday hours settings', isDangerous: false },
          { key: 'settings.holiday_hours.edit', name: 'Holiday Hours - Edit', description: 'Modify holiday hours', isDangerous: true },
          { key: 'settings.roles.view', name: 'Role Management - View', description: 'View role management page', isDangerous: false },
          { key: 'settings.roles.edit', name: 'Role Management - Edit', description: 'Manage roles and permissions', isDangerous: true },
          { key: 'settings.branding.view', name: 'Branding & Colors - View', description: 'View branding and color settings', isDangerous: false },
          { key: 'settings.branding.edit', name: 'Branding & Colors - Edit', description: 'Modify branding and colors', isDangerous: true },
          { key: 'settings.scheduling.view', name: 'Scheduling Settings - View', description: 'View scheduling configuration', isDangerous: false },
          { key: 'settings.scheduling.edit', name: 'Scheduling Settings - Edit', description: 'Modify scheduling settings', isDangerous: true },
          { key: 'settings.payments.view', name: 'Tavari Pay - View', description: 'View payment processing settings', isDangerous: false },
          { key: 'settings.payments.edit', name: 'Tavari Pay - Edit', description: 'Configure payment processing', isDangerous: true },
          { key: 'settings.taxes.view', name: 'Tax Settings - View', description: 'View tax configuration', isDangerous: false },
          { key: 'settings.taxes.edit', name: 'Tax Settings - Edit', description: 'Modify tax rates and settings', isDangerous: true },
          { key: 'settings.security.view', name: 'Security Settings - View', description: 'View security settings', isDangerous: false },
          { key: 'settings.security.edit', name: 'Security Settings - Edit', description: 'Modify security settings and policies', isDangerous: true }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - Role Management',
        permissions: [
          { key: 'settings.roles.create', name: 'Create Roles', description: 'Create custom user roles', isDangerous: true },
          { key: 'settings.roles.update', name: 'Update Roles', description: 'Modify role permissions', isDangerous: true },
          { key: 'settings.roles.delete', name: 'Delete Roles', description: 'Remove custom roles', isDangerous: true },
          { key: 'settings.roles.assign', name: 'Assign Roles', description: 'Assign roles to users', isDangerous: true }
        ]
      },
      {
        name: 'Granular - User Management',
        permissions: [
          { key: 'settings.users.view', name: 'View Users', description: 'View user accounts and roles', isDangerous: false },
          { key: 'settings.users.create', name: 'Create Users', description: 'Add new user accounts', isDangerous: false },
          { key: 'settings.users.update', name: 'Update Users', description: 'Modify user information and roles', isDangerous: true },
          { key: 'settings.users.delete', name: 'Delete Users', description: 'Remove user accounts', isDangerous: true }
        ]
      },
      {
        name: 'Granular - Security Settings',
        permissions: [
          { key: 'settings.security.view_logs', name: 'View Security Logs', description: 'Access security and audit logs', isDangerous: false },
          { key: 'settings.security.configure', name: 'Configure Security', description: 'Modify security settings and policies', isDangerous: true },
          { key: 'settings.security.export_logs', name: 'Export Security Logs', description: 'Export security and audit logs', isDangerous: true }
        ]
      }
    ]
  },

  payments: {
    name: 'Payments & Finance',
    icon: '💳',
    description: 'Payment processing and financial management',
    categories: [
      // Page-level access (View Only / View & Edit)
      {
        name: 'Pages',
        permissions: [
          { key: 'payments.processing.view', name: 'Payment Processing - View', description: 'View payment processing page', isDangerous: false },
          { key: 'payments.processing.edit', name: 'Payment Processing - Edit', description: 'Process payments and transactions', isDangerous: true },
          { key: 'payments.onboarding.view', name: 'Merchant Onboarding - View', description: 'View merchant onboarding status', isDangerous: false },
          { key: 'payments.onboarding.edit', name: 'Merchant Onboarding - Edit', description: 'Complete merchant onboarding', isDangerous: true },
          { key: 'payments.settlements.view', name: 'Settlements & Payouts - View', description: 'View settlements and payout history', isDangerous: false },
          { key: 'payments.settlements.edit', name: 'Settlements & Payouts - Edit', description: 'Manage settlements and payouts', isDangerous: true },
          { key: 'payments.refunds.view', name: 'Refunds & Disputes - View', description: 'View refunds and disputes', isDangerous: false },
          { key: 'payments.refunds.edit', name: 'Refunds & Disputes - Edit', description: 'Process refunds and handle disputes', isDangerous: true },
          { key: 'payments.settings.view', name: 'Payment Settings - View', description: 'View payment settings', isDangerous: false },
          { key: 'payments.settings.edit', name: 'Payment Settings - Edit', description: 'Modify payment processor settings', isDangerous: true }
        ]
      },
      // Granular operations (inherit defaults from page-level)
      {
        name: 'Granular - Payment Processing',
        permissions: [
          { key: 'payments.process', name: 'Process Payments', description: 'Process customer payments', isDangerous: false },
          { key: 'payments.void', name: 'Void Payments', description: 'Void payment transactions', isDangerous: true },
          { key: 'payments.tokenize', name: 'Tokenize Cards', description: 'Tokenize payment instruments for future use', isDangerous: false },
          { key: 'payments.charge', name: 'Charge Cards', description: 'Charge tokenized payment instruments', isDangerous: true },
          { key: 'payments.view_transactions', name: 'View Transactions', description: 'View payment transaction history', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Refunds & Disputes',
        permissions: [
          { key: 'payments.refund', name: 'Issue Refunds', description: 'Process payment refunds', isDangerous: true },
          { key: 'payments.partial_refund', name: 'Partial Refunds', description: 'Process partial payment refunds', isDangerous: true },
          { key: 'payments.handle_disputes', name: 'Handle Disputes', description: 'Respond to payment disputes and chargebacks', isDangerous: true },
          { key: 'payments.view_disputes', name: 'View Disputes', description: 'View dispute and chargeback history', isDangerous: false }
        ]
      },
      {
        name: 'Granular - Settlements & Payouts',
        permissions: [
          { key: 'payments.view_settlements', name: 'View Settlements', description: 'View settlement reports and history', isDangerous: false },
          { key: 'payments.view_payouts', name: 'View Payouts', description: 'View payout history and schedules', isDangerous: false },
          { key: 'payments.manage_payouts', name: 'Manage Payouts', description: 'Configure payout schedules and settings', isDangerous: true },
          { key: 'payments.export_settlements', name: 'Export Settlement Data', description: 'Export settlement and payout reports', isDangerous: false }
        ]
      }
    ]
  },

  appbuilder: {
    name: 'App Builder',
    icon: '📱',
    description: 'White-label app configuration and management',
    categories: [
      {
        name: 'Branding Management',
        permissions: [
          {
            key: 'appbuilder.branding.view',
            name: 'View Branding',
            description: 'View app branding configuration',
            isDangerous: false
          },
          {
            key: 'appbuilder.branding.edit',
            name: 'Edit Branding',
            description: 'Modify app branding (colors, logos, icons)',
            isDangerous: false
          },
          {
            key: 'appbuilder.branding.manage',
            name: 'Manage Branding',
            description: 'Full control over branding configuration',
            isDangerous: false
          }
        ]
      },
      {
        name: 'Module Management',
        permissions: [
          {
            key: 'appbuilder.modules.view',
            name: 'View Modules',
            description: 'View available and enabled modules',
            isDangerous: false
          },
          {
            key: 'appbuilder.modules.toggle',
            name: 'Toggle Modules',
            description: 'Enable or disable modules for the app',
            isDangerous: false
          }
        ]
      },
      {
        name: 'Build Management',
        permissions: [
          {
            key: 'appbuilder.build.view',
            name: 'View Builds',
            description: 'View app build history and status',
            isDangerous: false
          },
          {
            key: 'appbuilder.build.create',
            name: 'Create Builds',
            description: 'Trigger new app builds',
            isDangerous: false
          },
          {
            key: 'appbuilder.build.cancel',
            name: 'Cancel Builds',
            description: 'Cancel running builds',
            isDangerous: false
          }
        ]
      },
      {
        name: 'Deployment Management',
        permissions: [
          {
            key: 'appbuilder.deploy.view',
            name: 'View Deployments',
            description: 'View deployment status and store listings',
            isDangerous: false
          },
          {
            key: 'appbuilder.deploy.manage',
            name: 'Manage Deployments',
            description: 'Submit apps to stores and manage listings',
            isDangerous: true
          }
        ]
      },
      {
        name: 'Analytics',
        permissions: [
          {
            key: 'appbuilder.analytics.view',
            name: 'View Analytics',
            description: 'View app usage and performance analytics',
            isDangerous: false
          },
          {
            key: 'appbuilder.analytics.export',
            name: 'Export Analytics',
            description: 'Export analytics data',
            isDangerous: false
          }
        ]
      }
    ]
  },
  reminders: {
    name: 'Tavari Reminder',
    icon: '🔔',
    description: 'Employee email and portal reminders',
    categories: [
      {
        name: 'Pages',
        permissions: [
          { key: 'reminders.dashboard.view', name: 'Reminders - View', description: 'View scheduled reminders', isDangerous: false },
          { key: 'reminders.dashboard.edit', name: 'Reminders - Edit', description: 'Create and edit reminders', isDangerous: false },
          { key: 'reminders.history.view', name: 'Send History - View', description: 'View reminder delivery history', isDangerous: false },
        ],
      },
    ],
  },
  invoices: {
    name: 'Tavari Invoices',
    icon: '🧾',
    description: 'Customer and business invoicing with online payments',
    categories: [
      {
        name: 'Pages',
        permissions: [
          { key: 'invoices.view', name: 'Invoices - View', description: 'View invoices and summary documents', isDangerous: false },
          { key: 'invoices.create', name: 'Invoices - Create', description: 'Create and edit invoices', isDangerous: false },
          { key: 'invoices.send', name: 'Invoices - Send', description: 'Send invoices by email', isDangerous: false },
          { key: 'invoices.void', name: 'Invoices - Void', description: 'Void unpaid invoices', isDangerous: true },
          { key: 'invoices.refund', name: 'Invoices - Refund', description: 'Refund paid invoices', isDangerous: true },
          { key: 'invoices.settings', name: 'Invoices - Settings', description: 'Manage invoice settings and reminders', isDangerous: false },
        ],
      },
    ],
  },
  gift_cards: {
    name: 'Gift Cards',
    icon: '🎁',
    description: 'Digital gift cards, prepaid vouchers, liability, and redemptions',
    categories: [
      {
        name: 'Operations',
        permissions: [
          { key: 'gift_cards.view', name: 'Gift Cards - View', description: 'View gift cards, balances, and reports', isDangerous: false },
          { key: 'gift_cards.sell', name: 'Gift Cards - Sell / Issue', description: 'Sell and issue gift cards', isDangerous: false },
          { key: 'gift_cards.redeem', name: 'Gift Cards - Redeem', description: 'Redeem gift cards at checkout', isDangerous: false },
          { key: 'gift_cards.reprint', name: 'Gift Cards - Reprint', description: 'Reprint gift cards after verifying purchaser', isDangerous: true },
          { key: 'gift_cards.void', name: 'Gift Cards - Void / Adjust', description: 'Void or adjust gift card balances', isDangerous: true },
          { key: 'gift_cards.promos', name: 'Gift Cards - Promotions', description: 'Manage gift card promotions and burn campaigns', isDangerous: false },
          { key: 'gift_cards.settings', name: 'Gift Cards - Settings', description: 'Manage gift card settings, designs, and cross-business links', isDangerous: true },
        ],
      },
    ],
  },
  deals: {
    name: 'Deals & Coupons',
    icon: '🏷️',
    description: 'Marketing deals, printable coupons, and promotional vouchers',
    categories: [
      {
        name: 'Operations',
        permissions: [
          { key: 'deals.view', name: 'Deals - View', description: 'View deals and vouchers', isDangerous: false },
          { key: 'deals.create', name: 'Deals - Create', description: 'Create and edit deals', isDangerous: false },
          { key: 'deals.print', name: 'Deals - Print vouchers', description: 'Generate and print coupon vouchers', isDangerous: false },
          { key: 'deals.redeem', name: 'Deals - Redeem', description: 'Redeem deal vouchers at checkout', isDangerous: false },
          { key: 'deals.settings', name: 'Deals - Settings', description: 'Manage deals module settings', isDangerous: false },
        ],
      },
    ],
  },
  funding: {
    name: 'Tavari Funding',
    icon: '💰',
    description: 'Business plans, loan and grant applications, and funding program alerts',
    categories: [
      {
        name: 'Pages',
        permissions: [
          { key: 'funding.view', name: 'Funding - View', description: 'View funding plans and applications', isDangerous: false },
          { key: 'funding.edit', name: 'Funding - Edit', description: 'Create and edit plans, applications, and collaborators', isDangerous: false },
          { key: 'funding.settings', name: 'Funding - Settings', description: 'Manage Funding module settings and funder templates', isDangerous: false },
          { key: 'funding.sensitive', name: 'Funding - Sensitive fields', description: 'View decrypted sensitive funding fields', isDangerous: true },
        ],
      },
    ],
  },
};

export default PERMISSION_REGISTRY;



