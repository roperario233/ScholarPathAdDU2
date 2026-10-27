-- ---------------------------------------------------------------------------
-- FORM 230-SCH asks the financial-difficulty reasons and the coping strategies
-- as "check as many" lists, the daily food intake as Adequate / Inadequate, and
-- the mode of transport as Public transport / Private car / Others.
--
-- The per-application answers therefore record two lists
-- (`difficultyReasons` / `difficultyCoping`, option keys) with their "Other"
-- free text (`difficultyOther` / `copingOther`), the food-intake answer
-- (`foodIntakeAdequacy`), and the transport choice (`transportMode` with
-- `transportOther`). See src/lib/financialDetails.js.
--
-- A draft submitted before this migration holds free text in the old columns, so
-- the gate accepts either shape and nothing already submitted is invalidated.
-- CREATE OR REPLACE keeps the EXECUTE revokes from 20261036000001.
-- ---------------------------------------------------------------------------
create or replace function public.financial_multi_select_answered(p_value jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when p_value is null then false
    when jsonb_typeof(p_value) = 'array' then jsonb_array_length(p_value) > 0
    when jsonb_typeof(p_value) = 'string' then char_length(btrim(p_value #>> '{}')) > 0
    else false
  end;
$$;

create or replace function public.financial_answers_complete(p_answers jsonb)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_answers ->> 'otherIncomeAnswer', '') in ('yes', 'no')
    and coalesce(p_answers ->> 'difficultyAnswer', '') in ('yes', 'no')
    and (
      p_answers ->> 'difficultyAnswer' = 'no'
      or (
        public.financial_multi_select_answered(p_answers -> 'difficultyReasons')
        and public.financial_multi_select_answered(p_answers -> 'difficultyCoping')
        -- An "Other" answer needs its free text, like the workspace requires.
        and (
          jsonb_typeof(p_answers -> 'difficultyReasons') is distinct from 'array'
          or not (p_answers -> 'difficultyReasons') @> '["other"]'::jsonb
          or char_length(btrim(coalesce(p_answers ->> 'difficultyOther', ''))) > 0
        )
        and (
          jsonb_typeof(p_answers -> 'difficultyCoping') is distinct from 'array'
          or not (p_answers -> 'difficultyCoping') @> '["other"]'::jsonb
          or char_length(btrim(coalesce(p_answers ->> 'copingOther', ''))) > 0
        )
      )
    )
    and coalesce(p_answers ->> 'allowanceEnough', '') in ('yes', 'no')
    -- Adequate / Inadequate, or the free-text description a draft saved earlier holds.
    and (
      coalesce(p_answers ->> 'foodIntakeAdequacy', '') in ('adequate', 'inadequate')
      or char_length(btrim(coalesce(p_answers ->> 'foodIntake', ''))) > 0
    )
    and char_length(btrim(coalesce(p_answers ->> 'transportMode', ''))) > 0
    and coalesce(p_answers ->> 'allowanceDaily', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and coalesce(p_answers ->> 'expenseFood', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and coalesce(p_answers ->> 'expenseTransport', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and coalesce(p_answers ->> 'expenseOther', '') ~ '^[0-9]+(\.[0-9]+)?$';
$$;
