-- Create scheduling_events table
CREATE TABLE IF NOT EXISTS scheduling_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  event_name TEXT NOT NULL,
  event_description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE scheduling_events ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_scheduling_events_business_id ON scheduling_events(business_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_events_date ON scheduling_events(event_date);

-- RLS Policies
CREATE POLICY "Users can view events in their business"
ON scheduling_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = scheduling_events.business_id
      AND bu.user_id = auth.uid()
  )
);

CREATE POLICY "Managers can create events"
ON scheduling_events
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = scheduling_events.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Managers can update events"
ON scheduling_events
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = scheduling_events.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'manager')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = scheduling_events.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'manager')
  )
);

CREATE POLICY "Managers can delete events"
ON scheduling_events
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM business_users bu
    WHERE bu.business_id = scheduling_events.business_id
      AND bu.user_id = auth.uid()
      AND bu.role IN ('owner', 'manager')
  )
);

