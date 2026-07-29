"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkDtrStatus,
  getInternshipFiles,
  getOngoingInternshipRecord,
  getUserProfile,
  getUserSession,
} from "./services";
import {
  clockIn,
  clockOut,
  getDailyNarratives,
  getDtrs,
} from "./student-actions";
import { toast } from "sonner";

//////////////////////////////////////
// SIMPLE QUERIES
//////////////////////////////////////
export function useSession() {
  const { isPending, isError, data, error } = useQuery({
    queryKey: ["session"],
    queryFn: getUserSession,
  });

  return { isPending, isError, data, error };
}

export function useProfile() {
  const { isPending, isError, data, error } = useQuery({
    queryKey: ["userProfile"],
    queryFn: getUserProfile,
  });

  return { isPending, isError, data, error };
}

export function useActiveInternship() {
  const { isPending, isError, data, error } = useQuery({
    queryKey: ["ongoingInternship"],
    queryFn: getOngoingInternshipRecord,
  });

  return { isPending, isError, data, error };
}

export function useDtrStatus() {
  const { isPending, isError, data, error } = useQuery({
    queryKey: ["dtrStatus"],
    queryFn: checkDtrStatus,
  });

  return { isPending, isError, data, error };
}

export function useDtrs(currPage) {
  const { isPending, isError, data, error } = useQuery({
    queryKey: ["dtrs"],
    queryFn: () => getDtrs(currPage),
  });

  return { isPending, isError, data, error };
}

export function useNarratives(currPage) {
  const { isPending, isError, data, error } = useQuery({
    queryKey: ["narratives"],
    queryFn: () => getDailyNarratives(currPage),
  });

  return { isPending, isError, data, error };
}

export function useInternshipFiles() {
  const { isPending, isError, data, error } = useQuery({
    queryKey: ["files"],
    queryFn: getInternshipFiles,
  });

  return { isPending, isError, data, error };
}

//////////////////////////////////////
// MUTATIONS
//////////////////////////////////////
export function useDtrMutation(status) {
  const queryClient = useQueryClient();
  const isClockingIn = status === "clocked-out";

  return useMutation({
    mutationFn: (formData) =>
      isClockingIn ? clockIn(formData) : clockOut(formData),
    onSuccess: (data) => {
      if (data.success) {
        toast.success(isClockingIn ? "Clock-in success" : "Clock-out success");

        queryClient.invalidateQueries({
          queryKey: ["dtrStatus", "dtrs", "ongoingInternship", "narratives"],
        });
      } else {
        toast.error(data.error || "Something went wrong");
      }
    },
    onError: (error) => {
      toast.error("Network error occurred");
      console.error(error);
    },
  });
}
