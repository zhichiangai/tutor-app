
do $migration$
declare src text;
begin
 src:=pg_catalog.pg_get_functiondef('tutor_private.submit_range_payment(uuid,uuid,date,date,date,numeric,text)'::regprocedure);
 if position('p_paid_on>current_date' in src)=0 then raise exception 'Expected date guard missing'; end if;
 src:=replace(src,'p_paid_on>current_date','p_paid_on>(now() at time zone ''Asia/Taipei'')::date');
 execute src;
 src:=pg_catalog.pg_get_functiondef('tutor_private.review_range_payment(uuid,boolean,date)'::regprocedure);
 if position('p_received_on>current_date' in src)=0 then raise exception 'Expected receipt guard missing'; end if;
 src:=replace(src,'p_received_on>current_date','p_received_on>(now() at time zone ''Asia/Taipei'')::date');
 execute src;
end $migration$;
