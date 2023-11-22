import { supabase } from "../lib/supabaseClient";

export async function saveCustomAgenda(agendaData) {
  let updates = {
    name: agendaData.meetingInfo.name,
    template: agendaData.type,
    date: new Date(agendaData.meetingInfo.date).toISOString(),
    workgroup_id: agendaData.workgroup_id,
    summary: agendaData,
    updated_at: new Date
  }
  
  const { data, error } = await supabase
    .from('meetingsummaries')
    .upsert(updates, { onConflict: ['name', 'date', 'workgroup_id', 'user_id'] });

  if (error) {
    console.error('Error upserting data:', error);
    return false;
  }

  return data;
}
