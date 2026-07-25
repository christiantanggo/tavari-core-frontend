-- Add zone_id foreign key to digital_signage_schedule_items
-- This must be run AFTER digital_signage_zones table is created
-- Run this file after: digital_signage_create_zones_table.sql

ALTER TABLE digital_signage_schedule_items
ADD CONSTRAINT digital_signage_schedule_items_zone_id_fkey 
    FOREIGN KEY (zone_id) 
    REFERENCES digital_signage_zones(id) 
    ON DELETE SET NULL;



