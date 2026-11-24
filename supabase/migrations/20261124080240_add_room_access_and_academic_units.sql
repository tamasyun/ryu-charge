BEGIN;

CREATE TABLE public.academic_units (
  id text PRIMARY KEY,
  parent_id text REFERENCES public.academic_units(id) CHECK (parent_id <> id),
  name text NOT NULL,
  sort_order integer NOT NULL
);

CREATE TABLE public.room_access_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL REFERENCES public.rooms(id),
  user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  weekdays smallint[] NOT NULL CHECK (
    cardinality(weekdays) BETWEEN 1 AND 7
    AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at)
);

CREATE INDEX room_access_posts_room_id_idx ON public.room_access_posts(room_id, created_at DESC);
CREATE INDEX room_access_posts_user_id_idx ON public.room_access_posts(user_id);

CREATE TABLE public.room_access_audiences (
  post_id uuid NOT NULL REFERENCES public.room_access_posts(id) ON DELETE CASCADE,
  unit_id text NOT NULL REFERENCES public.academic_units(id),
  PRIMARY KEY (post_id, unit_id)
);

CREATE INDEX room_access_audiences_unit_id_idx ON public.room_access_audiences(unit_id);
CREATE INDEX academic_units_parent_id_idx ON public.academic_units(parent_id);

ALTER TABLE public.academic_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_access_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_access_audiences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.academic_units, public.room_access_posts, public.room_access_audiences FROM public, anon, authenticated;
GRANT SELECT ON public.academic_units, public.room_access_posts, public.room_access_audiences TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_units TO service_role;
GRANT INSERT (room_id, weekdays, starts_at, ends_at), UPDATE (weekdays, starts_at, ends_at)
  ON public.room_access_posts TO authenticated;
GRANT INSERT (post_id, unit_id) ON public.room_access_audiences TO authenticated;
GRANT DELETE ON public.room_access_posts, public.room_access_audiences TO authenticated;

CREATE POLICY read_academic_units ON public.academic_units
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY read_room_access_posts ON public.room_access_posts
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY read_room_access_audiences ON public.room_access_audiences
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY insert_own_room_access ON public.room_access_posts
  FOR INSERT TO authenticated WITH CHECK (
    user_id = (SELECT auth.uid())
    AND lower(coalesce((SELECT auth.jwt())->>'email', '')) ~
      '^[^@[:space:]]+@([a-z0-9-]+[.])*u-ryukyu[.]ac[.]jp$'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()))
  );
CREATE POLICY update_own_room_access ON public.room_access_posts
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY delete_own_room_access ON public.room_access_posts
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY insert_own_room_access_audience ON public.room_access_audiences
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.room_access_posts p WHERE p.id = post_id AND p.user_id = (SELECT auth.uid()))
  );
CREATE POLICY delete_own_room_access_audience ON public.room_access_audiences
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.room_access_posts p WHERE p.id = post_id AND p.user_id = (SELECT auth.uid()))
  );

CREATE TRIGGER guard_account_write BEFORE INSERT OR UPDATE OR DELETE ON public.room_access_posts
  FOR EACH ROW EXECUTE FUNCTION account_private.guard_account_write();
CREATE TRIGGER guard_account_write BEFORE INSERT OR DELETE ON public.room_access_audiences
  FOR EACH ROW EXECUTE FUNCTION account_private.guard_account_write();

-- 投稿本体と対象所属を同じトランザクションで保存する。編集時は投稿行を先にロックする。
CREATE FUNCTION public.save_room_access(
  p_room_id text, p_weekdays smallint[], p_starts_at time, p_ends_at time,
  p_unit_ids text[], p_post_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE saved_id uuid;
BEGIN
  IF coalesce(cardinality(p_unit_ids), 0) = 0 THEN
    RAISE EXCEPTION 'room_access_requires_audience' USING ERRCODE = '23514';
  END IF;

  IF p_post_id IS NULL THEN
    INSERT INTO public.room_access_posts (room_id, weekdays, starts_at, ends_at)
      VALUES (p_room_id, p_weekdays, p_starts_at, p_ends_at) RETURNING id INTO saved_id;
  ELSE
    UPDATE public.room_access_posts SET weekdays = p_weekdays, starts_at = p_starts_at, ends_at = p_ends_at
      WHERE id = p_post_id AND room_id = p_room_id RETURNING id INTO saved_id;
    IF saved_id IS NULL THEN
      RAISE EXCEPTION 'room_access_not_editable' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.room_access_audiences WHERE post_id = saved_id;
  END IF;

  INSERT INTO public.room_access_audiences (post_id, unit_id)
    SELECT DISTINCT saved_id, unit_id FROM unnest(p_unit_ids) AS unit_id;
  RETURN saved_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_room_access(text, smallint[], time, time, text[], uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_room_access(text, smallint[], time, time, text[], uuid) TO authenticated;

-- APIから直接書き込む場合も、最終的に対象所属が空になる投稿を拒否する。
CREATE FUNCTION account_private.require_room_access_audience() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE target_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'room_access_posts' THEN
    target_id := NEW.id;
  ELSE
    target_id := OLD.post_id;
  END IF;
  PERFORM 1 FROM public.room_access_posts WHERE id = target_id FOR UPDATE;
  IF FOUND AND NOT EXISTS (SELECT 1 FROM public.room_access_audiences WHERE post_id = target_id) THEN
    RAISE EXCEPTION 'room_access_requires_audience' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION account_private.require_room_access_audience() FROM public, anon, authenticated;

CREATE CONSTRAINT TRIGGER room_access_post_has_audience
  AFTER INSERT ON public.room_access_posts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION account_private.require_room_access_audience();
CREATE CONSTRAINT TRIGGER room_access_post_keeps_audience
  AFTER DELETE ON public.room_access_audiences DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION account_private.require_room_access_audience();

-- ryukyu_university_affiliations.json（2026年度）の学部配下を初期データに使用する。
-- 管理者は parent_id と sort_order で所属の階層と表示順を管理できる。
INSERT INTO public.academic_units (id, parent_id, name, sort_order) VALUES
  ('humanities', NULL, '人文社会学部', 1),
  ('law-politics', 'humanities', '国際法政学科', 1),
  ('law', 'law-politics', '法学プログラム', 1),
  ('advanced-legal-practice', 'law', '特修法曹コース', 1),
  ('politics', 'law-politics', '政治・国際関係学プログラム', 2),
  ('human-society', 'humanities', '人間社会学科', 2),
  ('philosophy', 'human-society', '哲学プログラム', 1),
  ('psychology', 'human-society', '心理学プログラム', 2),
  ('sociology', 'human-society', '社会学プログラム', 3),
  ('peaceful-coexistence', 'sociology', '平和共生社会コース', 1),
  ('social-welfare', 'sociology', '社会福祉学コース', 2),
  ('ryukyu-asia', 'humanities', '琉球アジア文化学科', 3),
  ('history-folklore', 'ryukyu-asia', '歴史民俗学プログラム', 1),
  ('literature', 'ryukyu-asia', '文学プログラム', 2),
  ('linguistics', 'ryukyu-asia', '言語学プログラム', 3),
  ('regional', NULL, '国際地域創造学部', 2),
  ('regional-studies', 'regional', '国際地域創造学科', 1),
  ('regional-day', 'regional-studies', '昼間主コース', 1),
  ('tourism', 'regional-day', '観光地域デザインプログラム', 1),
  ('management', 'regional-day', '経営プログラム', 2),
  ('economics', 'regional-day', '経済学プログラム', 3),
  ('global-language', 'regional-day', '国際言語文化プログラム', 4),
  ('regional-culture', 'regional-day', '地域文化科学プログラム', 5),
  ('regional-night', 'regional-studies', '夜間主コース', 2),
  ('night-management', 'regional-night', '経営プログラム', 1),
  ('night-economics', 'regional-night', '経済学プログラム', 2),
  ('night-global-language', 'regional-night', '国際言語文化プログラム', 3),
  ('education', NULL, '教育学部', 3),
  ('teacher-training', 'education', '学校教育教員養成課程', 1),
  ('edu-primary', 'teacher-training', '小学校教育コース', 1),
  ('edu-school', 'edu-primary', '学校教育専攻', 1),
  ('edu-practice', 'edu-school', '教育実践学専修', 1),
  ('edu-child', 'edu-school', '子ども教育開発専修', 2),
  ('edu-primary-subject', 'edu-primary', '教科教育専攻', 2),
  ('edu-primary-subject-japanese', 'edu-primary-subject', '国語教育専修', 1),
  ('edu-primary-subject-social-studies', 'edu-primary-subject', '社会科教育専修', 2),
  ('edu-primary-subject-math', 'edu-primary-subject', '数学教育専修', 3),
  ('edu-primary-subject-science', 'edu-primary-subject', '理科教育専修', 4),
  ('edu-primary-subject-music', 'edu-primary-subject', '音楽教育専修', 5),
  ('edu-primary-subject-art', 'edu-primary-subject', '美術教育専修', 6),
  ('edu-primary-subject-physical-education', 'edu-primary-subject', '保健体育専修', 7),
  ('edu-primary-subject-technology', 'edu-primary-subject', '技術教育専修', 8),
  ('edu-primary-subject-life-sciences', 'edu-primary-subject', '生活科学教育専修', 9),
  ('edu-primary-subject-english', 'edu-primary-subject', '英語教育専修', 10),
  ('edu-secondary', 'teacher-training', '中学校教育コース', 2),
  ('edu-secondary-subject', 'edu-secondary', '教科教育専攻', 1),
  ('edu-secondary-subject-japanese', 'edu-secondary-subject', '国語教育専修', 1),
  ('edu-secondary-subject-social-studies', 'edu-secondary-subject', '社会科教育専修', 2),
  ('edu-secondary-subject-math', 'edu-secondary-subject', '数学教育専修', 3),
  ('edu-secondary-subject-science', 'edu-secondary-subject', '理科教育専修', 4),
  ('edu-secondary-subject-music', 'edu-secondary-subject', '音楽教育専修', 5),
  ('edu-secondary-subject-art', 'edu-secondary-subject', '美術教育専修', 6),
  ('edu-secondary-subject-physical-education', 'edu-secondary-subject', '保健体育専修', 7),
  ('edu-secondary-subject-technology', 'edu-secondary-subject', '技術教育専修', 8),
  ('edu-secondary-subject-life-sciences', 'edu-secondary-subject', '生活科学教育専修', 9),
  ('edu-secondary-subject-english', 'edu-secondary-subject', '英語教育専修', 10),
  ('edu-special', 'teacher-training', '特別支援教育コース', 3),
  ('edu-special-needs', 'edu-special', '特別支援教育専攻', 1),
  ('edu-special-field', 'edu-special-needs', '特別支援教育専修', 1),
  ('science', NULL, '理学部', 4),
  ('mathematics', 'science', '数理科学科', 1),
  ('physics-earth', 'science', '物質地球科学科', 2),
  ('physics', 'physics-earth', '物理系', 1),
  ('earth-environment', 'physics-earth', '地球環境系', 2),
  ('marine-science', 'science', '海洋自然科学科', 3),
  ('chemistry', 'marine-science', '化学系', 1),
  ('biology', 'marine-science', '生物系', 2),
  ('medicine', NULL, '医学部', 5),
  ('medical-science', 'medicine', '医学科', 1),
  ('health-sciences', 'medicine', '保健学科', 2),
  ('nursing', 'health-sciences', '看護学コース', 1),
  ('laboratory-science', 'health-sciences', '検査技術学コース', 2),
  ('engineering', NULL, '工学部', 6),
  ('engineering-department', 'engineering', '工学科', 1),
  ('mechanical', 'engineering-department', '機械工学コース', 1),
  ('energy', 'engineering-department', 'エネルギー機械工学コース', 2),
  ('electrical', 'engineering-department', '電気システム工学コース', 3),
  ('electronics', 'engineering-department', '電子情報通信コース', 4),
  ('civil', 'engineering-department', '社会基盤デザインコース', 5),
  ('architecture', 'engineering-department', '建築学コース', 6),
  ('computer-science', 'engineering-department', '知能情報コース', 7),
  ('agriculture', NULL, '農学部', 7),
  ('subtropical-agriculture', 'agriculture', '亜熱帯地域農学科', 1),
  ('agri-economics', 'subtropical-agriculture', '農林経済学コース', 1),
  ('crop-development', 'subtropical-agriculture', '植物開発学コース', 2),
  ('animal-production', 'subtropical-agriculture', '循環畜産学コース', 3),
  ('agri-symbiosis', 'subtropical-agriculture', '農林共生学コース', 4),
  ('forest-environment', 'agriculture', '亜熱帯農林環境科学科', 2),
  ('plant-functions', 'forest-environment', '植物機能学コース', 1),
  ('animal-functions', 'forest-environment', '動物機能学コース', 2),
  ('forest-sciences', 'forest-environment', '森林環境学コース', 3),
  ('ecology', 'forest-environment', '生態環境科学コース', 4),
  ('agri-engineering', 'agriculture', '地域農業工学科', 3),
  ('biosystems', 'agri-engineering', 'バイオシステム工学コース', 1),
  ('rural-environment', 'agri-engineering', '地域環境工学コース', 2),
  ('bioresources', 'agriculture', '亜熱帯生物資源科学科', 4),
  ('bioresource-functions', 'bioresources', '生物機能開発学コース', 1),
  ('food-science', 'bioresources', '食品機能科学コース', 2),
  ('fermentation', 'bioresources', '発酵・生命科学コース', 3),
  ('nutrition', 'bioresources', '健康栄養科学コース', 4);

COMMIT;
